/**
 * Shared session + gateway-proxy helpers for the Vercel serverless /api layer.
 *
 * Mirrors app/server/auth.ts + app/server/session.ts so the statically-hosted
 * panel (orole-os.vercel.app) gets the same-origin /api surface the Docker
 * server provides on Railway.
 *
 * Security model (issue #32): the browser holds only an opaque httpOnly
 * session cookie; the gateway key lives in a per-instance in-memory key ring.
 * On serverless this means a cold/routed-away instance returns 401 and the
 * client re-logins — annoying at worst, never insecure. globalThis caching
 * keeps warm instances consistent.
 */
import { randomBytes } from "node:crypto";

const GATEWAY_BASE =
  process.env.HERMES_GATEWAY_URL ?? "https://os.orole.be";

export const SESSION_COOKIE = "orole_session";
export const CSRF_COOKIE = "orole_csrf";
export const CSRF_HEADER = "x-csrf-token";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

interface Session {
  id: string;
  csrfToken: string;
  createdAt: number;
  expiresAt: number;
}

const store = globalThis as unknown as {
  __oroleSessions?: Map<string, Session>;
  __oroleKeys?: Map<string, string>;
};
store.__oroleSessions ??= new Map();
store.__oroleKeys ??= new Map();
const sessions = store.__oroleSessions;
const keyRing = store.__oroleKeys;

export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function createSession(): Session {
  const now = Date.now();
  const s: Session = {
    id: newToken(),
    csrfToken: newToken(),
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  };
  sessions.set(s.id, s);
  return s;
}

export function getSession(id: string | undefined): Session | null {
  if (!id) return null;
  const s = sessions.get(id);
  if (!s) return null;
  if (Date.now() > s.expiresAt) {
    sessions.delete(id);
    keyRing.delete(id);
    return null;
  }
  return s;
}

export function destroySession(id: string | undefined): void {
  if (!id) return;
  sessions.delete(id);
  keyRing.delete(id);
}

export function bindKey(sessionId: string, key: string): void {
  keyRing.set(sessionId, key);
}

export function getKeyFor(sessionId: string): string | undefined {
  return keyRing.get(sessionId);
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}


/** Resolve the session from cookie or Bearer stream token; null otherwise. */
export function authorize(req: Request): Session | null {
  const cookies = parseCookies(req.headers.get("cookie"));
  return getSession(cookies[SESSION_COOKIE]);
}

// Stream tokens: short-lived, single-use, mapped to owning session id.
const streamTokens = ((store as unknown as { __oroleStreams?: Record<string, number> })
  .__oroleStreams ??= {});
const streamTokenOwners = ((store as unknown as { __oroleStreamOwners?: Map<string, string> })
  .__oroleStreamOwners ??= new Map());

export function createStreamToken(sessionId: string): string {
  const token = `orole_stream_${newToken()}`;
  streamTokens[token] = Date.now() + 60_000;
  streamTokenOwners.set(token, sessionId);
  return token;
}

/** Redeem a single-use, short-lived stream token for its session. */
export function redeemStreamToken(token: string): Session | null {
  const exp = streamTokens[token];
  if (!exp || Date.now() > exp) return null;
  delete streamTokens[token];
  const owner = streamTokenOwners.get(token);
  streamTokenOwners.delete(token);
  return owner ? (sessions.get(owner) ?? null) : null;
}

/** Verify a candidate gateway key with a cheap authenticated call. */
export async function verifyGatewayKey(key: string): Promise<boolean> {
  try {
    const res = await fetch(`${GATEWAY_BASE}/v1/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function json(obj: unknown, status: number, extraHeaders?: HeadersInit): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", ...(extraHeaders ?? {}) },
  });
}

export function isSecure(req: Request): boolean {
  const proto =
    req.headers.get("x-forwarded-proto") ??
    new URL(req.url).protocol.replace(":", "");
  return proto === "https";
}

export function sessionCookieHeaders(s: Session, secure: boolean): string[] {
  const flags = `Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${secure ? "; Secure" : ""}`;
  return [
    `${SESSION_COOKIE}=${s.id}; ${flags}`,
    `${CSRF_COOKIE}=${s.csrfToken}; Path=/; SameSite=Lax${secure ? "; Secure" : ""}`,
  ];
}

export function clearCookieHeaders(): string[] {
  return [
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    `${CSRF_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0`,
  ];
}

/** Forward /api/gateway/* to the Hermes gateway with the bound key. */
export async function gatewayProxy(req: Request): Promise<Response> {
  const incoming = new URL(req.url);
  const upstreamPath = incoming.pathname.replace(/^\/api\/gateway/, "");
  const target = `${GATEWAY_BASE}${upstreamPath}${incoming.search}`;

  const headers = new Headers();
  const auth = req.headers.get("authorization");
  const viaToken = auth?.startsWith("Bearer ")
    ? redeemStreamToken(auth.slice(7).trim())
    : null;
  const effective = viaToken ?? authorize(req);
  if (!effective) return json({ error: "Not authenticated" }, 401);

  const key = getKeyFor(effective.id);
  if (!key) return json({ error: "No gateway key bound to this session" }, 401);

  headers.set("Authorization", `Bearer ${key}`);
  headers.set("accept", req.headers.get("accept") ?? "application/json");
  const ct = req.headers.get("content-type");
  if (ct) headers.set("content-type", ct);

  try {
    return await fetch(target, {
      method: req.method,
      headers,
      body:
        req.method === "GET" || req.method === "HEAD"
          ? undefined
          : await req.arrayBuffer(),
    });
  } catch {
    return json({ error: "Gateway unreachable" }, 502);
  }
}

/**
 * Shared session + gateway-proxy helpers for the Vercel serverless /api layer.
 * Plain ESM JavaScript so @vercel/node needs no TS compilation.
 *
 * Mirrors app/server/auth.ts: the browser holds only an opaque httpOnly
 * session cookie; the gateway key lives in a per-instance in-memory key ring
 * (an instance miss degrades to 401 → client re-login, never insecure).
 */
import { randomBytes } from "node:crypto";

export const GATEWAY_BASE =
  process.env.HERMES_GATEWAY_URL ?? "https://os.orole.be";

export const SESSION_COOKIE = "orole_session";
export const CSRF_COOKIE = "orole_csrf";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

const store = globalThis;
store.__oroleSessions ??= new Map();
store.__oroleKeys ??= new Map();
store.__oroleStreams ??= new Map();
const sessions = store.__oroleSessions;
const keyRing = store.__oroleKeys;
const streamTokens = store.__oroleStreams; // token → {owner, expiresAt}

export function newToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function createSession() {
  const now = Date.now();
  const s = {
    id: newToken(),
    csrfToken: newToken(),
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  };
  sessions.set(s.id, s);
  return s;
}

export function getSession(id) {
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

export function destroySession(id) {
  if (!id) return;
  sessions.delete(id);
  keyRing.delete(id);
}

export function authorize(req) {
  return getSession(parseCookies(req.headers.get("cookie"))[SESSION_COOKIE]);
}

export function bindKey(sessionId, key) {
  keyRing.set(sessionId, key);
}

export function getKeyFor(sessionId) {
  return keyRing.get(sessionId);
}

export function parseCookies(header) {
  const out = {};
  for (const part of (header ?? "").split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function createStreamToken(sessionId) {
  const token = `orole_stream_${newToken()}`;
  streamTokens.set(token, { owner: sessionId, expiresAt: Date.now() + 60_000 });
  return token;
}

export function redeemStreamToken(token) {
  const entry = streamTokens.get(token);
  if (!entry || Date.now() > entry.expiresAt) return null;
  streamTokens.delete(token);
  return sessions.get(entry.owner) ?? null;
}

/** Verify a candidate gateway key with a cheap authenticated call. */
export async function verifyGatewayKey(key) {
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

export function json(obj, status = 200, extraHeaders) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", ...(extraHeaders ?? {}) },
  });
}

function isSecure(req) {
  const proto =
    req.headers.get("x-forwarded-proto") ??
    new URL(req.url).protocol.replace(":", "");
  return proto === "https";
}

export function sessionCookieHeaders(s, secure) {
  const flags = `Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${secure ? "; Secure" : ""}`;
  return [
    `${SESSION_COOKIE}=${s.id}; ${flags}`,
    `${CSRF_COOKIE}=${s.csrfToken}; Path=/; SameSite=Lax${secure ? "; Secure" : ""}`,
  ];
}

export function clearCookieHeaders() {
  return [
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    `${CSRF_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0`,
  ];
}

/** Forward an /api/gateway/* request to the Hermes gateway with the bound key. */
export async function gatewayProxy(req) {
  const incoming = new URL(req.url);
  const upstreamPath = incoming.pathname.replace(/^\/api\/gateway/, "");
  const target = `${GATEWAY_BASE}${upstreamPath}${incoming.search}`;

  const auth = req.headers.get("authorization");
  const viaToken = auth?.startsWith("Bearer ")
    ? redeemStreamToken(auth.slice(7).trim())
    : null;
  const session = viaToken ?? authorize(req);
  if (!session) return json({ error: "Not authenticated" }, 401);

  const key = getKeyFor(session.id);
  if (!key) return json({ error: "No gateway key bound to this session" }, 401);

  const headers = new Headers();
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

// Auth + session-protected gateway API routes for the Orole-OS panel.
//
// POST /api/auth/login      — exchange the gateway key (entered once) for a
//                             httpOnly/SameSite=Lax session cookie. The key is
//                             verified against the Hermes gateway and never
//                             stored or echoed back to the browser.
// POST /api/auth/logout     — destroy the session, clear cookies.
// GET  /api/auth/session    — lightweight liveness check used by the UI.
// GET  /api/auth/stream-token — short-lived bearer token so SSE can connect via
//                              fetch with an Authorization header (no ?token=
//                              in URLs or logs).
// ALL /api/gateway/*        — proxy to the Hermes gateway using the server-held
//                             key; requires a valid session. Approve/deny also
//                             require CSRF double-submit + Origin match.

import {
  authorize,
  clearCookieHeaders,
  createSession,
  createStreamToken,
  getSessionFromRequest,
  redeemStreamToken,
  sessionCookieHeaders,
  sessionStore,
  type Session,
} from "./session.ts";

const GATEWAY_BASE = process.env.HERMES_GATEWAY_URL ?? "https://os.orole.be";

function json(obj: unknown, status: number, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", ...(extraHeaders ?? {}) },
  });
}

function isSecureRequest(req: Request): boolean {
  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
  return proto === "https";
}

/** Verify a candidate key against a cheap authenticated gateway call. */
async function verifyGatewayKey(key: string): Promise<boolean> {
  try {
    const res = await fetch(`${GATEWAY_BASE}/v1/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    // Gateway unreachable — fail closed rather than issuing a session that
    // can only end in confusing 401s from every proxied call.
    return false;
  }
}

export async function login(req: Request): Promise<Response> {
  if (authorize(req, { csrf: false }) === null && getSessionFromRequest(req)) {
    return json({ ok: true, alreadyAuthenticated: true }, 200);
  }
  const body = (await req.json().catch(() => null)) as { apiKey?: string } | null;
  const key = body?.apiKey?.trim();
  if (!key || key.length < 8 || key.length > 512) {
    return json({ error: "A valid gateway API key is required" }, 400);
  }

  const ok = await verifyGatewayKey(key);
  if (!ok) {
    return json({ error: "The gateway rejected this key" }, 401);
  }

  // Hold the key only in process memory, keyed by session id.
  const session = createSession();
  keyRing.set(session.id, key);

  const headers = new Headers({ "content-type": "application/json" });
  // Separate Set-Cookie headers (never comma-joined — browsers parse them
  // as one broken cookie otherwise).
  for (const c of sessionCookieHeaders(session, isSecureRequest(req))) {
    headers.append("set-cookie", c);
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

const keyRing = new Map<string, string>();

export function getGatewayKeyForSession(sessionId: string): string | undefined {
  return keyRing.get(sessionId);
}

export async function logout(req: Request): Promise<Response> {
  const session = getSessionFromRequest(req);
  if (session) {
    keyRing.delete(session.id);
    sessionStore.delete(session.id);
  }
  const headers = new Headers({ "content-type": "application/json" });
  for (const c of clearCookieHeaders()) {
    headers.append("set-cookie", c);
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

export function sessionStatus(req: Request): Response {
  const session = getSessionFromRequest(req);
  return json({ authenticated: Boolean(session) }, 200);
}

export function streamToken(req: Request): Response {
  const failure = authorize(req, { csrf: false }); // GET → session only
  if (failure) return json({ error: failure }, 401);
  const session = getSessionFromRequest(req)!;
  return json({ token: createStreamToken(session.id), expiresIn: 60 }, 200);
}

/**
 * Proxy any /api/gateway/* request to the Hermes gateway with the server-held
 * key. `csrf` endpoints additionally require the double-submit token.
 */
export async function gatewayProxy(req: Request, opts?: { csrf?: boolean }): Promise<Response> {
  const failure = authorize(req, opts);
  if (failure) {
    return json(
      { error: failure === "no-session" ? "Not authenticated" : `Request rejected (${failure})` },
      failure === "no-session" ? 401 : 403,
    );
  }
  const session = getSessionFromRequest(req) as Session;

  // Bearer-authenticated streaming requests (SSE via fetch) may present a
  // stream token instead of the cookie.
  let effective = session;
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    // fall through — cookie session already validated above
  } else {
    const viaToken = redeemStreamToken(auth.slice(7).trim());
    if (viaToken) effective = viaToken;
  }

  const key = getGatewayKeyForSession(effective.id);
  if (!key) return json({ error: "No gateway key bound to this session" }, 401);

  const incoming = new URL(req.url);
  const upstreamUrl = `${GATEWAY_BASE}${incoming.pathname.replace(/^\/api\/gateway/, "")}${incoming.search}`;

  const headers = new Headers();
  headers.set("Authorization", `Bearer ${key}`);
  headers.set("accept", req.headers.get("accept") ?? "application/json");
  const ct = req.headers.get("content-type");
  if (ct) headers.set("content-type", ct);

  const upstream = await fetch(upstreamUrl, {
    method: req.method,
    headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
    // @ts-expect-error duplex for streaming bodies in Node
    duplex: "half",
  });

  const outHeaders = new Headers();
  for (const name of ["content-type", "cache-control", "content-length"]) {
    const v = upstream.headers.get(name);
    if (v) outHeaders.set(name, v);
  }
  return new Response(upstream.body, { status: upstream.status, headers: outHeaders });
}

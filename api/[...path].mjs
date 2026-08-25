/**
 * Orole-OS API — single catch-all serverless function (Vercel).
 *
 * Provides the same-origin /api surface the statically-hosted panel needs:
 *
 *   POST /api/auth/login         exchange gateway key for httpOnly cookie
 *   POST /api/auth/logout        destroy session
 *   GET  /api/auth/session       liveness check
 *   GET  /api/auth/stream-token  short-lived SSE bearer token
 *   ANY  /api/gateway/*          proxy to Hermes gateway with server-held key
 *
 * Self-contained on purpose: Vercel's function bundler mishandled shared
 * imports from an api/ subdirectory, so everything lives in this file.
 * Sessions/key ring are per-instance memory — an instance miss degrades to
 * 401 → client re-login, never insecure.
 */
import { randomBytes } from "node:crypto";

const GATEWAY_BASE = process.env.HERMES_GATEWAY_URL ?? "https://os.orole.be";
const SESSION_COOKIE = "orole_session";
const CSRF_COOKIE = "orole_csrf";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

// Warm-instance singletons
const store = globalThis;
store.__oroleSessions ??= new Map();
store.__oroleKeys ??= new Map();
store.__oroleStreams ??= new Map();
const sessions = store.__oroleSessions;
const keyRing = store.__oroleKeys;
const streamTokens = store.__oroleStreams;

const newToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

function createSession() {
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

function getSession(id) {
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

export default async function handler(req) {
  try {
    return await route(req);
  } catch (err) {
    return json({ error: "Internal error", detail: String(err?.message ?? err) }, 500);
  }
}

async function route(req) {
  const url = new URL(req.url);
  const p = url.pathname.replace(/\/+$/, "") || "/";
  const method = req.method ?? "GET";

  // ---- /api/gateway/* proxy ----
  if (p.startsWith("/api/gateway")) {
    return gatewayProxy(req, url);
  }

  // ---- auth ----
  if (p === "/api/auth/login" && method === "POST") {
    if (authorize(req)) return json({ ok: true, alreadyAuthenticated: true }, 200);

    const body = await req.json().catch(() => null);
    const key = body?.apiKey?.trim();
    if (!key || key.length < 8 || key.length > 512) {
      return json({ error: "A valid gateway API key is required" }, 400);
    }
    if (!(await verifyGatewayKey(key))) {
      return json({ error: "The gateway rejected this key" }, 401);
    }
    const session = createSession();
    keyRing.set(session.id, key);

    const headers = new Headers({ "content-type": "application/json" });
    for (const c of cookieHeaders(session)) headers.append("set-cookie", c);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  }

  if (p === "/api/auth/logout" && method === "POST") {
    const id = parseCookies(req.headers.get("cookie"))[SESSION_COOKIE];
    if (id) {
      sessions.delete(id);
      keyRing.delete(id);
    }
    const headers = new Headers({ "content-type": "application/json" });
    headers.append(
      "set-cookie",
      `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    );
    headers.append("set-cookie", `${CSRF_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0`);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  }

  if (p === "/api/auth/session") {
    return json({ authenticated: Boolean(authorize(req)) }, 200);
  }

  if (p === "/api/auth/stream-token") {
    const session = authorize(req);
    if (!session) return json({ error: "Not authenticated" }, 401);
    const token = `orole_stream_${newToken()}`;
    streamTokens.set(token, { owner: session.id, expiresAt: Date.now() + 60_000 });
    return json({ token, expiresIn: 60 }, 200);
  }

  return json({ error: "Not found" }, 404);
}

// ---- helpers ----

function parseCookies(header) {
  const out = {};
  for (const part of (header ?? "").split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function authorize(req) {
  return getSession(parseCookies(req.headers.get("cookie"))[SESSION_COOKIE]);
}

async function verifyGatewayKey(key) {
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

function cookieHeaders(s) {
  return [
    `${SESSION_COOKIE}=${s.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}; Secure`,
    `${CSRF_COOKIE}=${s.csrfToken}; Path=/; SameSite=Lax; Secure`,
  ];
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function gatewayProxy(req, incomingUrl) {
  let session = authorize(req);
  const auth = req.headers.get("authorization");
  if (!session && auth?.startsWith("Bearer ")) {
    session = redeemStreamToken(auth.slice(7).trim());
  }
  if (!session) return json({ error: "Not authenticated" }, 401);

  const key = keyRing.get(session.id);
  if (!key) return json({ error: "No gateway key bound to this session" }, 401);

  const upstreamPath = incomingUrl.pathname.replace(/^\/api\/gateway/, "");
  const target = `${GATEWAY_BASE}${upstreamPath}${incomingUrl.search}`;

  const headers = new Headers();
  headers.set("Authorization", `Bearer ${key}`);
  headers.set("accept", req.headers.get("accept") ?? "application/json");
  const ct = req.headers.get("content-type");
  if (ct) headers.set("content-type", ct);

  return fetch(target, {
    method: req.method,
    headers,
    body:
      req.method === "GET" || req.method === "HEAD"
        ? undefined
        : await req.arrayBuffer(),
  }).catch(() => json({ error: "Gateway unreachable" }, 502));
}

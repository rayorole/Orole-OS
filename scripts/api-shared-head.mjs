// Shared preamble for the per-route /api serverless functions.
// Inlined into each file at build time by scripts/gen-api.mjs because
// Vercel does not bundle shared imports from api/ subdirectories.
import { randomBytes } from "node:crypto";

const GATEWAY_BASE = process.env.HERMES_GATEWAY_URL ?? "https://os.orole.be";
const SESSION_COOKIE = "orole_session";
const CSRF_COOKIE = "orole_csrf";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

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

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function cookieHeaders(s) {
  return [
    `${SESSION_COOKIE}=${s.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}; Secure`,
    `${CSRF_COOKIE}=${s.csrfToken}; Path=/; SameSite=Lax; Secure`,
  ];
}

// Normalize Vercel's Node-style (req,res) args into a Web Request.
function toWebRequest(req, res) {
  if (typeof req.headers?.get === "function") return req; // already Web Request
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers ?? {})) {
    headers.set(k, Array.isArray(v) ? v.join(", ") : String(v));
  }
  const url = `https://${req.headers.host ?? "localhost"}${req.url ?? "/"}`;
  return new Request(url, {
    method: req.method,
    headers,
    body: ["GET", "HEAD"].includes(req.method) ? undefined : req,
    // @ts-expect-error duplex
    duplex: "half",
  });
}

function sendWeb(res, webResponse) {
  for (const [k, v] of webResponse.headers) {
    if (k === "set-cookie") res.setHeader("set-cookie", webResponse.headers.getSetCookie?.() ?? [v]);
    else res.setHeader(k, v);
  }
  res.statusCode = webResponse.status;
  if (webResponse.body) {
    void webResponse.body.pipeTo(new WritableStream({
      write(c) { res.write(Buffer.from(c)); },
      close() { res.end(); },
      abort() { res.end(); },
    }));
  } else {
    res.end();
  }
}

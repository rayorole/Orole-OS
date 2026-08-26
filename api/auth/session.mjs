// Shared preamble for the per-route /api serverless functions.
// Inlined into each file at build time by scripts/gen-api.mjs because
// Vercel does not bundle shared imports from api/ subdirectories.
//
// SESSIONS ARE STATELESS (#79): the whole session — id, CSRF token, expiry,
// and the AES-256-GCM-encrypted gateway key — lives inside the httpOnly
// orole_session cookie itself. No server-side Map survives across Vercel
// serverless instances, so nothing is stored in process memory. The cookie
// ciphertext can only be produced with SESSION_SECRET, so it cannot be
// forged; if SESSION_SECRET is unset a fallback secret is derived from the
// gateway key at first use, which keeps deployments working without extra
// config (an attacker who knows the gateway key could forge cookies, but
// they could already call the gateway directly — no privilege gained).
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

const GATEWAY_BASE = process.env.HERMES_GATEWAY_URL ?? "https://os.orole.be";
const SESSION_COOKIE = "orole_session";
const CSRF_COOKIE = "orole_csrf";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

// streamTokens still needs short-lived cross-request state for voice streaming;
// it is best-effort only and every consumer has a non-streaming fallback.
const store = globalThis;
store.__oroleStreams ??= new Map();
const streamTokens = store.__oroleStreams;

const newToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

function sessionSecret() {
  return process.env.SESSION_SECRET ?? null;
}

let fallbackSecret = null;
function getEncryptionKey() {
  const explicit = sessionSecret();
  if (!explicit) {
    // Fallback: derive from the gateway key so behavior still works without
    // extra config. See module docblock for the security tradeoff.
    fallbackSecret ??= `orole-os|${process.env.HERMES_GATEWAY_KEY ?? ""}`;
  }
  return createHash("sha256").update(String(explicit ?? fallbackSecret)).digest();
}

/** Encrypt + authenticate an arbitrary JSON-serializable payload → base64url token. */
function sealSession(payload) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64url");
}

/** Inverse of sealSession; returns null on any tamper/parse/expiry failure. */
function unsealSession(token) {
  if (!token) return null;
  try {
    const raw = Buffer.from(token, "base64url");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ct = raw.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
    const payload = JSON.parse(pt);
    if (typeof payload !== "object" || payload === null) return null;
    if (typeof payload.expiresAt !== "number" || Date.now() > payload.expiresAt) return null;
    return payload;
  } catch {
    return null;
  }
}

function createSession(key) {
  const now = Date.now();
  return {
    id: newToken(),
    csrfToken: newToken(),
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
    key, // gateway API key, sealed inside the cookie — never stored server-side
  };
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

/**
 * Authorize from the cookie alone — works identically in every serverless
 * instance because the session travels with the request.
 */
function authorize(req) {
  const s = unsealSession(parseCookies(req.headers.get("cookie"))[SESSION_COOKIE]);
  return s && typeof s.key === "string" ? s : null;
}

/** Constant-time CSRF check against the session's embedded csrfToken. */
function csrfOk(req, session) {
  const header = req.headers.get("x-csrf-token") ?? parseCookies(req.headers.get("cookie"))[CSRF_COOKIE];
  if (!header || !session?.csrfToken) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(session.csrfToken);
  return a.length === b.length && timingSafeEqual(a, b);
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

/** Set-Cookie headers for a freshly created session (key sealed inside). */
function cookieHeaders(s) {
  return [
    `${SESSION_COOKIE}=${sealSession(s)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}; Secure`,
    `${CSRF_COOKIE}=${s.csrfToken}; Path=/; SameSite=Lax; Secure`,
  ];
}


export const config = { runtime: "nodejs" };

export default async function handler(req) {
  return json({ authenticated: Boolean(authorize(req)) }, 200);
}

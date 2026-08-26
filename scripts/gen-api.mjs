#!/usr/bin/env node
/**
 * Generates the per-route /api serverless functions by inlining
 * scripts/api-shared-head.mjs into each file (Vercel does not bundle
 * shared imports from api/ subdirectories). Run before `vercel` builds:
 * it is wired as the prebuild step in vercel.json.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";

const head = readFileSync("scripts/api-shared-head.mjs", "utf8");
const wrap = (body) => `${head}\n\nexport const config = { runtime: "nodejs" };\n\n${body}\n`;

rmSync("api", { recursive: true, force: true });
mkdirSync("api/auth", { recursive: true });
mkdirSync("api/gateway", { recursive: true });

writeFileSync(
  "api/auth/login.mjs",
  wrap(`export default serve(async function (req) {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (authorize(req)) return json({ ok: true, alreadyAuthenticated: true }, 200);

  const body = await req.json().catch(() => null);
  const key = body?.apiKey?.trim();
  if (!key || key.length < 8 || key.length > 512) {
    return json({ error: "A valid gateway API key is required" }, 400);
  }
  if (!(await verifyGatewayKey(key))) {
    return json({ error: "The gateway rejected this key" }, 401);
  }

  const session = createSession(key);

  const headers = new Headers({ "content-type": "application/json" });
  for (const c of cookieHeaders(session)) headers.append("set-cookie", c);
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
});`),
);

writeFileSync(
  "api/auth/logout.mjs",
  wrap(`export default serve(async function (req) {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  // Stateless: nothing to delete server-side — the cookie is the session.
  const headers = new Headers({ "content-type": "application/json" });
  headers.append("set-cookie", \`\${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0\`);
  headers.append("set-cookie", \`\${CSRF_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0\`);
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
});`),
);

writeFileSync(
  "api/auth/session.mjs",
  wrap(`export default serve(async function (req) {
  return json({ authenticated: Boolean(authorize(req)) }, 200);
});`),
);

writeFileSync(
  "api/auth/stream-token.mjs",
  wrap(`export default serve(async function (req) {
  const session = authorize(req);
  if (!session) return json({ error: "Not authenticated" }, 401);
  // Stateless stream token: a short-lived sealed session, no shared memory.
  const token = \`orole_stream_\${sealSession({ key: session.key, expiresAt: Date.now() + 60_000 })}\`;
  return json({ token, expiresIn: 60 }, 200);
});`),
);

writeFileSync(
  "api/gateway/[...path].mjs",
  wrap(`export default serve(async function (req) {
  try {
    const url = new URL(req.url);
    let session = authorize(req);
    const auth = req.headers.get("authorization");
    if (!session && auth?.startsWith("Bearer orole_stream_")) {
      // Stream tokens are sealed sessions themselves — unseal directly.
      const s = unsealSession(auth.slice(7).trim());
      if (s?.stream && typeof s.key === "string") session = { ...s, csrfToken: "" };
    }
    if (!session) return json({ error: "Not authenticated" }, 401);

    const key = session.key;
    if (!key) return json({ error: "No gateway key bound to this session" }, 401);

    const upstreamPath = url.pathname.replace(/^\\/api\\/gateway/, "");
    const target = \`\${GATEWAY_BASE}\${upstreamPath}\${url.search}\`;

    const headers = new Headers();
    headers.set("Authorization", \`Bearer \${key}\`);
    headers.set("accept", req.headers.get("accept") ?? "application/json");
    const ct = req.headers.get("content-type");
    if (ct) headers.set("content-type", ct);

    return await fetch(target, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD"
        ? undefined
        : await req.arrayBuffer(),
    }).catch(() => json({ error: "Gateway unreachable" }, 502));
  } catch (err) {
    return json({ error: "Internal error", detail: String(err?.message ?? err) }, 500);
  }
});`),
);

console.log("generated api/ functions");

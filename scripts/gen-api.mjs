#!/usr/bin/env node
/**
 * Generates the per-route /api serverless functions by inlining
 * scripts/api-shared-head.mjs into each file (Vercel does not bundle
 * shared imports from api/ subdirectories). Run before `vercel` builds:
 * files are committed so CI needs no extra hook.
 *
 * Handlers accept both Web Request and Node-style (req, res) signatures:
 * Vercel's nodejs runtime passes (IncomingMessage, ServerResponse).
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";

const head = readFileSync("scripts/api-shared-head.mjs", "utf8");

// Each route body is written against the Web Request API; wrap() adapts args.
const adapt = (body) => `export default async function handler(req, res) {
  const request = toWebRequest(req, res);
  try {
    const response = await handle(request);
    if (res && typeof res.setHeader === "function") {
      sendWeb(res, response);
      return;
    }
    return response;
  } catch (err) {
    console.error("[api]", err);
    const fail = json({ error: "Internal error" }, 500);
    if (res && typeof res.setHeader === "function") { sendWeb(res, fail); return; }
    return fail;
  }

  async function handle(request) {\n${body}\n  }
}\n`;

rmSync("api", { recursive: true, force: true });
mkdirSync("api/auth", { recursive: true });
mkdirSync("api/gateway", { recursive: true });

const files = {
  "api/auth/login.mjs": `if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (authorize(request)) return json({ ok: true, alreadyAuthenticated: true }, 200);

    const body = await request.json().catch(() => null);
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
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });`,

  "api/auth/logout.mjs": `if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const id = parseCookies(request.headers.get("cookie"))[SESSION_COOKIE];
    if (id) {
      sessions.delete(id);
      keyRing.delete(id);
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: [
        ["content-type", "application/json"],
        ["set-cookie", \`\${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0\`],
        ["set-cookie", \`\${CSRF_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0\`],
      ],
    });`,

  "api/auth/session.mjs": `return json({ authenticated: Boolean(authorize(request)) }, 200);`,

  "api/auth/stream-token.mjs": `const session = authorize(request);
    if (!session) return json({ error: "Not authenticated" }, 401);
    const token = \`orole_stream_\${newToken()}\`;
    streamTokens.set(token, { owner: session.id, expiresAt: Date.now() + 60_000 });
    return json({ token, expiresIn: 60 }, 200);`,

  "api/gateway/[...path].mjs": `let session = authorize(request);
    const auth = request.headers.get("authorization");
    if (!session && auth?.startsWith("Bearer ")) {
      const raw = auth.slice(7).trim();
      const entry = streamTokens.get(raw);
      if (entry && Date.now() <= entry.expiresAt) {
        streamTokens.delete(raw);
        session = sessions.get(entry.owner) ?? null;
      }
    }
    if (!session) return json({ error: "Not authenticated" }, 401);

    const key = keyRing.get(session.id);
    if (!key) return json({ error: "No gateway key bound to this session" }, 401);

    const upstreamPath = url.pathname.replace(/^\\/api\\/gateway/, "");
    const target = \`\${GATEWAY_BASE}\${upstreamPath}\${url.search}\`;

    const headers = new Headers();
    headers.set("Authorization", \`Bearer \${key}\`);
    headers.set("accept", request.headers.get("accept") ?? "application/json");
    const ct = request.headers.get("content-type");
    if (ct) headers.set("content-type", ct);

    return await fetch(target, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await request.arrayBuffer(),
    }).catch(() => json({ error: "Gateway unreachable" }, 502));`,
};

for (const [path, body] of Object.entries(files)) {
  let out = `${head}\n\nexport const config = { runtime: "nodejs" };\n\n${adapt(body)}\n`;
  // The gateway route also needs the URL object.
  if (path.includes("[...path]")) {
    out = out.replace(
      "async function handle(request) {",
      'async function handle(request) {\n    const url = new URL(request.url);',
    );
  }
  writeFileSync(path, out);
}

console.log("generated api/ functions");

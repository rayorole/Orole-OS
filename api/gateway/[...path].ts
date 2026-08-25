/**
 * /api/gateway/[...path] — session-authenticated proxy to the Hermes gateway.
 * Attaches the server-held key; the browser never sees it.
 */
import { authorize, getKeyFor, redeemStreamToken } from "../_lib/session";

export const config = { runtime: "nodejs" };

const GATEWAY_BASE =
  process.env.HERMES_GATEWAY_URL ?? "https://os.orole.be";

export default async function handler(req: Request): Promise<Response> {
  // Bearer stream token (SSE) may stand in for the cookie.
  const auth = req.headers.get("authorization");
  const viaToken = auth?.startsWith("Bearer ")
    ? redeemStreamToken(auth.slice(7).trim())
    : null;
  const session = viaToken ?? authorize(req);
  if (!session) {
    return new Response(JSON.stringify({ error: "Not authenticated" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const key = getKeyFor(session.id);
  if (!key) {
    return new Response(
      JSON.stringify({ error: "No gateway key bound to this session" }),
      { status: 401, headers: { "content-type": "application/json" } },
    );
  }

  const incoming = new URL(req.url);
  // Vercel rewrites keep the full path; strip the /api/gateway prefix.
  const upstreamPath = incoming.pathname.replace(/^\/api\/gateway/, "");
  const target = `${GATEWAY_BASE}${upstreamPath}${incoming.search}`;

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
    return new Response(JSON.stringify({ error: "Gateway unreachable" }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
}

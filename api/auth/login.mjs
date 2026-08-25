/** /api/auth/login — exchange the gateway key (typed once) for an httpOnly cookie. */
import {
  authorize,
  bindKey,
  createSession,
  isSecure,
  json,
  sessionCookieHeaders,
  verifyGatewayKey,
} from "../_lib/session.mjs";

export const config = { runtime: "nodejs" };

export default async function handler(req) {
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

  const session = createSession();
  bindKey(session.id, key);

  const headers = new Headers({ "content-type": "application/json" });
  for (const c of sessionCookieHeaders(session, isSecure(req))) headers.append("set-cookie", c);
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

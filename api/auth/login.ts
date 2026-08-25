/**
 * /api/auth/login — exchange the gateway key (typed once) for an httpOnly
 * session cookie. The key is verified against the Hermes gateway and never
 * echoed back or persisted.
 */
import {
  bindKey,
  createSession,
  isSecure,
  json,
  sessionCookieHeaders,
  verifyGatewayKey,
  authorize,
} from "../_lib/session";

export const config = { runtime: "nodejs" };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Already signed in? Report success without re-verifying.
  if (authorize(req)) {
    return json({ ok: true, alreadyAuthenticated: true }, 200);
  }

  const body = (await req.json().catch(() => null)) as { apiKey?: string } | null;
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
  for (const c of sessionCookieHeaders(session, isSecure(req))) {
    headers.append("set-cookie", c);
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

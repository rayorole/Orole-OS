/** /api/auth/logout — destroy the session, clear cookies. */
import {
  clearCookieHeaders,
  destroySession,
  json,
  parseCookies,
  SESSION_COOKIE,
} from "../_lib/session";

export const config = { runtime: "nodejs" };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const cookies = parseCookies(req.headers.get("cookie"));
  destroySession(cookies[SESSION_COOKIE]);
  const headers = new Headers({ "content-type": "application/json" });
  for (const c of clearCookieHeaders()) headers.append("set-cookie", c);
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

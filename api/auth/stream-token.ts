/** /api/auth/stream-token — short-lived single-use bearer token for SSE. */
import { authorize, createStreamToken, json } from "../_lib/session";

export const config = { runtime: "nodejs" };

export default async function handler(req: Request): Promise<Response> {
  const session = authorize(req);
  if (!session) return json({ error: "Not authenticated" }, 401);
  return json({ token: createStreamToken(session.id), expiresIn: 60 }, 200);
}

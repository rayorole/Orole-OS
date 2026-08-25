/** /api/auth/session — lightweight liveness check used by the UI. */
import { authorize, json } from "../_lib/session";

export const config = { runtime: "nodejs" };

export default async function handler(req: Request): Promise<Response> {
  return json({ authenticated: Boolean(authorize(req)) }, 200);
}

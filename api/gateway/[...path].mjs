/**
 * /api/gateway/* catch-all — session-authenticated proxy to the Hermes
 * gateway. Attaches the server-held key; the browser never sees it.
 */
import { gatewayProxy } from "../_lib/session.mjs";

export const config = { runtime: "nodejs" };

export default async function handler(req) {
  return gatewayProxy(req);
}

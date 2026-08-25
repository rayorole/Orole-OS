// Minimal Node HTTP server that serves the built SPA and mounts the
// ElevenLabs proxy routes. Run with: node server/index.mjs (after `npm run build`)
//
// Security (issue #32):
// - /api/auth/login exchanges the gateway key (entered once) for an
//   httpOnly/SameSite=Lax session cookie; the browser never stores the key.
// - All /api routes require a session; approve/deny additionally require CSRF.
// - SSE connects via fetch + ReadableStream with a bearer stream token — no
//   ?token= in URLs or logs.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { sttProxy, ttsProxy, rateLimit } from "./elevenlabs.ts";
import {
  login,
  logout,
  sessionStatus,
  streamToken,
  gatewayProxy,
} from "./auth.ts";

const DIST = join(fileURLToPath(new URL("../dist", import.meta.url)));
const PORT = Number(process.env.PORT ?? 8787);

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

// Endpoints that mutate agent state and therefore demand CSRF protection.
const CSRF_PATH = /^\/api\/gateway\/.*(approve|deny|cancel|retry|resume)/i;

type NodeReq = IncomingMessage & { body?: unknown };

function toWebRequest(req: IncomingMessage, url: URL, withBody: boolean): Request {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") headers.set(k, v);
    else if (Array.isArray(v)) headers.set(k, v.join(", "));
  }
  return new Request(url.href, {
    method: req.method ?? "GET",
    headers,
    body: withBody ? (req as unknown as ReadableStream) : undefined,
    // @ts-expect-error duplex is required for streaming request bodies in Node
    duplex: "half",
  });
}

function proxy(res: ServerResponse, fn: () => Promise<Response>) {
  fn()
    .then((upstream: Response) => {
      const headers: Record<string, string | string[]> = {};
      for (const [k, v] of upstream.headers) {
        if (k === "set-cookie") {
          // Preserve multiple Set-Cookie headers (login/logout).
          headers[k] = [...upstream.headers.getSetCookie()];
        } else {
          headers[k] = v;
        }
      }
      res.writeHead(upstream.status, headers);
      if (upstream.body) {
        // Pipe the web stream into the node response
        void upstream.body.pipeTo(
          new WritableStream({
            write(chunk) {
              res.write(Buffer.from(chunk));
            },
            close() {
              res.end();
            },
            abort() {
              res.end();
            },
          }),
        );
      } else {
        res.end();
      }
    })
    .catch((err: unknown) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: (err as Error)?.message ?? "proxy failure" }));
    });
}

/** Wrap a proxied call with per-session rate limiting on the ElevenLabs endpoints. */
function limitedProxy(res: ServerResponse, sessionId: string, fn: () => Promise<Response>) {
  if (!rateLimit(sessionId)) {
    res.writeHead(429, { "content-type": "application/json" });
    return void res.end(JSON.stringify({ error: "Rate limit exceeded (20 req/min)" }));
  }
  return proxy(res, fn);
}

const server = createServer(async (req: NodeReq, res: ServerResponse) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const p = url.pathname;
  const hasBody = req.method !== "GET" && req.method !== "HEAD";

  try {
    // ---- Auth ----
    if (p === "/api/auth/login" && req.method === "POST") {
      return proxy(res, () => login(toWebRequest(req, url, true)));
    }
    if (p === "/api/auth/logout" && req.method === "POST") {
      return proxy(res, () => logout(toWebRequest(req, url, false)));
    }
    if (p === "/api/auth/session" && req.method === "GET") {
      return proxy(res, () => Promise.resolve(sessionStatus(toWebRequest(req, url, false))));
    }
    if (p === "/api/auth/stream-token" && req.method === "GET") {
      return proxy(res, () => Promise.resolve(streamToken(toWebRequest(req, url, false))));
    }

    // ---- Gateway proxy (session required; CSRF for approve/deny etc.) ----
    if (p.startsWith("/api/gateway/")) {
      return proxy(res, () =>
        gatewayProxy(toWebRequest(req, url, hasBody), { csrf: CSRF_PATH.test(p) }),
      );
    }

    // ---- ElevenLabs proxy (session + rate limit) ----
    const { getSessionFromRequest } = await import("./session.ts");
    const session = getSessionFromRequest(toWebRequest(req, url, false));

    if ((p === "/api/elevenlabs/speech-to-text" || p === "/api/elevenlabs/tts") && req.method === "POST") {
      if (!session) {
        res.writeHead(401, { "content-type": "application/json" });
        return void res.end(JSON.stringify({ error: "Not authenticated" }));
      }
      if (p === "/api/elevenlabs/speech-to-text") {
        return limitedProxy(res, session.id, () => sttProxy(toWebRequest(req, url, true)));
      }
      return limitedProxy(res, session.id, () => ttsProxy(toWebRequest(req, url, true)));
    }
    if (p.startsWith("/api/")) {
      res.writeHead(404, { "content-type": "application/json" });
      return void res.end(JSON.stringify({ error: "Not found" }));
    }

    // Static files with SPA fallback
    let filePath = normalize(join(DIST, decodeURIComponent(p)));
    if (!filePath.startsWith(DIST)) throw new Error("forbidden");
    let s = await stat(filePath).catch(() => null);
    if (!s || s.isDirectory()) {
      filePath = join(DIST, "index.html");
      s = await stat(filePath);
    }
    const data = await readFile(filePath);
    res.writeHead(200, { "content-type": (MIME as Record<string, string>)[extname(filePath)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404).end("Not found");
  }
});

server.listen(PORT, () => {
  console.log(`Orole-OS server on http://localhost:${PORT}`);
});

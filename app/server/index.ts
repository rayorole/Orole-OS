// Minimal Node HTTP server that serves the built SPA and mounts the
// ElevenLabs proxy routes. Run with: node server/index.mjs (after `npm run build`)

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { sttProxy, ttsProxy } from "./elevenlabs.ts";

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

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

  if (url.pathname === "/api/elevenlabs/speech-to-text" && req.method === "POST") {
    return proxy(res, () => sttProxy(req as unknown as Request));
  }
  if (url.pathname === "/api/elevenlabs/tts" && req.method === "POST") {
    return proxy(res, () =>
      ttsProxy(
        new Request(url.href, {
          method: "POST",
          headers: req.headers,
          body: req,
          // @ts-expect-error duplex for streaming
          duplex: "half",
        }) as unknown as Request,
      ),
    );
  }

  // Static files with SPA fallback
  try {
    let filePath = normalize(join(DIST, decodeURIComponent(url.pathname)));
    if (!filePath.startsWith(DIST)) throw new Error("forbidden");
    let s = await stat(filePath).catch(() => null);
    if (!s || s.isDirectory()) {
      filePath = join(DIST, "index.html");
      s = await stat(filePath);
    }
    const data = await readFile(filePath);
    res.writeHead(200, { "content-type": MIME[extname(filePath)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404).end("Not found");
  }
});

function proxy(res, fn) {
  fn()
    .then((upstream) => {
      res.writeHead(upstream.status, Object.fromEntries(upstream.headers));
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
    .catch((err) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: err?.message ?? "proxy failure" }));
    });
}

server.listen(PORT, () => {
  console.log(`Orole-OS server on http://localhost:${PORT}`);
});

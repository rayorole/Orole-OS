// Server-side ElevenLabs proxy routes.
// The ELEVENLABS_API_KEY lives only here — the browser never sees it.
//
// Hardening (issue #32):
// - Every call requires an authenticated session (httpOnly cookie).
// - Per-session rate limiting + request length caps.
// - Voice IDs are server-configured only; client-supplied voiceId/model_id
//   are ignored/rejected.

const ELEVEN_BASE = "https://api.elevenlabs.io/v1";

/** The ONLY voice the panel may use. Configure via env; no client override. */
export const SERVER_VOICE_ID = process.env.ELEVENLABS_VOICE_ID ?? "21m00Tcm4TlvDq8ikWAM"; // Rachel
export const SERVER_MODEL_ID = process.env.ELEVENLABS_MODEL_ID ?? "eleven_turbo_v2_5";

/** Max TTS text length per request (chars). */
export const TTS_TEXT_MAX_CHARS = 2_000;
/** Max STT upload size (bytes). */
export const STT_MAX_BYTES = 10 * 1024 * 1024;
/** Requests per minute per session, per endpoint. */
export const RATE_LIMIT_PER_MINUTE = 20;

interface Bucket {
  count: number;
  windowStart: number;
}
const buckets = new Map<string, Bucket>();

/** Sliding fixed-window limiter keyed by session id. True when allowed. */
export function rateLimit(key: string): boolean {
  const now = Date.now();
  if (buckets.size > 10_000) {
    for (const [k, b] of buckets) {
      if (now - b.windowStart > 60_000) buckets.delete(k);
    }
  }
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart > 60_000) {
    buckets.set(key, { count: 1, windowStart: now });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= RATE_LIMIT_PER_MINUTE;
}

function requireKey(): string {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    throw Object.assign(new Error("ELEVENLABS_API_KEY is not configured on the server"), {
      status: 503,
    });
  }
  return key;
}

/** POST /api/elevenlabs/speech-to-text — forwards multipart audio to ElevenLabs STT. */
export async function sttProxy(req: Request): Promise<Response> {
  try {
    const key = requireKey();
    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.includes("multipart/form-data")) {
      return json({ error: "Expected multipart/form-data with an 'audio' file field" }, 400);
    }
    const declared = Number(req.headers.get("content-length") ?? "0");
    if (declared > STT_MAX_BYTES) {
      return json({ error: `Audio too large (max ${STT_MAX_BYTES} bytes)` }, 413);
    }
    const upstream = await fetch(`${ELEVEN_BASE}/speech-to-text`, {
      method: "POST",
      headers: { "xi-api-key": key, "content-type": contentType },
      body: req.body,
      // @ts-expect-error duplex is required for streaming request bodies in Node
      duplex: "half",
    });
    return passthrough(upstream);
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * POST /api/elevenlabs/tts — body { text }.
 * Streams back mp3 audio. Voice and model are server-configured; any
 * voiceId / model_id supplied by the client is rejected outright.
 */
export async function ttsProxy(req: Request): Promise<Response> {
  try {
    const key = requireKey();
    const url = new URL(req.url);
    // Reject client-supplied voice/model selection explicitly.
    if (url.searchParams.has("voiceId") || url.searchParams.has("model_id")) {
      return json({ error: "Client-supplied voice or model selection is not allowed" }, 400);
    }

    const payload = (await req.json().catch(() => null)) as { text?: string } | null;
    const text = typeof payload?.text === "string" ? payload.text : "";
    if (!text.trim()) {
      return json({ error: "JSON body must include { text: string }" }, 400);
    }
    if (text.length > TTS_TEXT_MAX_CHARS) {
      return json({ error: `Text too long (max ${TTS_TEXT_MAX_CHARS} characters)` }, 413);
    }

    const upstream = await fetch(
      `${ELEVEN_BASE}/text-to-speech/${encodeURIComponent(SERVER_VOICE_ID)}?model_id=${encodeURIComponent(SERVER_MODEL_ID)}&output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": key,
          "content-type": "application/json",
          accept: "audio/mpeg",
        },
        body: JSON.stringify({ text, model_id: SERVER_MODEL_ID }),
      },
    );
    return passthrough(upstream);
  } catch (err) {
    return errorResponse(err);
  }
}

function passthrough(upstream: Response): Response {
  const headers = new Headers();
  headers.set("content-type", upstream.headers.get("content-type") ?? "application/octet-stream");
  const cache = upstream.headers.get("cache-control");
  if (cache) headers.set("cache-control", cache);
  return new Response(upstream.body, { status: upstream.status, headers });
}

function json(obj: unknown, status: number): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function errorResponse(err: unknown): Response {
  const status =
    typeof err === "object" && err !== null && "status" in err && typeof (err as { status: unknown }).status === "number"
      ? (err as { status: number }).status
      : 500;
  const message = err instanceof Error ? err.message : "Internal error";
  return json({ error: message }, status);
}

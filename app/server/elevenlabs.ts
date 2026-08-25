// Server-side ElevenLabs proxy routes.
// The ELEVENLABS_API_KEY lives only here — the browser never sees it.

const ELEVEN_BASE = "https://api.elevenlabs.io/v1";

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
 * POST /api/elevenlabs/tts?voiceId=<id> — body { text }.
 * Streams back mp3 audio using eleven_turbo_v2_5 by default.
 */
export async function ttsProxy(req: Request): Promise<Response> {
  try {
    const key = requireKey();
    const url = new URL(req.url);
    const voiceId = url.searchParams.get("voiceId") ?? "21m00Tcm4TlvDq8ikWAM"; // Rachel
    const model = url.searchParams.get("model_id") ?? "eleven_turbo_v2_5";

    const payload = (await req.json().catch(() => null)) as { text?: string } | null;
    const text = typeof payload?.text === "string" ? payload.text : "";
    if (!text.trim()) {
      return json({ error: "JSON body must include { text: string }" }, 400);
    }

    const upstream = await fetch(
      `${ELEVEN_BASE}/text-to-speech/${encodeURIComponent(voiceId)}?model_id=${encodeURIComponent(model)}&output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": key,
          "content-type": "application/json",
          accept: "audio/mpeg",
        },
        body: JSON.stringify({ text, model_id: model }),
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

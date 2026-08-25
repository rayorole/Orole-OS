// Voice loop client: mic capture -> STT proxy -> Hermes chat -> TTS proxy.
// The ElevenLabs key never reaches the browser; all calls go through /api/elevenlabs/*.

export type VoiceState = "idle" | "recording" | "transcribing" | "thinking" | "speaking" | "error";

const HERMES_BASE = (import.meta.env.VITE_HERMES_BASE_URL as string | undefined) ?? "";

async function transcribe(blob: Blob): Promise<string> {
  const form = new FormData();
  const ext = blob.type.includes("webm") ? "webm" : blob.type.includes("ogg") ? "ogg" : "mp4";
  form.append("audio", blob, `recording.${ext}`);
  form.append("model_id", "scribe_v1");
  const res = await fetch("/api/elevenlabs/speech-to-text", { method: "POST", body: form });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error((detail as { error?: string }).error ?? `STT failed (${res.status})`);
  }
  const data = (await res.json()) as { text?: string };
  return data.text ?? "";
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/** Send the transcript to the Hermes chat endpoint and return the reply text. */
export async function askHermes(transcript: string, history: ChatTurn[]): Promise<string> {
  const res = await fetch(`${HERMES_BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      messages: [...history, { role: "user", content: transcript }],
    }),
  });
  if (!res.ok) throw new Error(`Hermes chat failed (${res.status})`);
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? "";
}

/** Stream TTS audio for a reply and return an object URL ready for <audio>. */
export async function speak(text: string, voiceId?: string): Promise<string> {
  const qs = voiceId ? `?voiceId=${encodeURIComponent(voiceId)}` : "";
  const res = await fetch(`/api/elevenlabs/tts${qs}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error((detail as { error?: string }).error ?? `TTS failed (${res.status})`);
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

/**
 * Full push-to-talk voice loop.
 * Call start() on pointerdown, stop() on pointerup. State machine reflects
 * recording -> transcribing -> thinking -> speaking -> idle.
 */
export function createVoiceLoop(opts: {
  voiceId?: string;
  onState: (state: VoiceState, detail?: string) => void;
  onTranscript: (text: string) => void;
  onReply: (text: string, audioUrl: string) => void;
}) {
  let mediaRecorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let stream: MediaStream | null = null;
  let audioEl: HTMLAudioElement | null = null;
  let history: ChatTurn[] = [];
  let busy = false;

  async function start(): Promise<void> {
    if (busy || mediaRecorder) return;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks = [];
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : undefined;
      mediaRecorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      mediaRecorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
      mediaRecorder.start(250); // gather chunks every 250ms
      opts.onState("recording");
    } catch (err) {
      cleanupStream();
      opts.onState("error", err instanceof Error ? err.message : "Microphone access denied");
    }
  }

  async function stop(): Promise<void> {
    if (!mediaRecorder || busy) return;
    busy = true;
    const rec = mediaRecorder;
    mediaRecorder = null;

    const stopped = new Promise<Blob>((resolve) => {
      rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
    });
    rec.stop();
    cleanupStream();

    try {
      opts.onState("transcribing");
      const blob = await stopped;
      if (blob.size === 0) throw new Error("No audio captured");

      const transcript = await transcribe(blob);
      opts.onTranscript(transcript);

      opts.onState("thinking");
      const reply = await askHermes(transcript, history);
      history = (
        [
          ...history,
          { role: "user" as const, content: transcript },
          { role: "assistant" as const, content: reply },
        ] satisfies ChatTurn[]
      ).slice(-12);

      opts.onState("speaking");
      const url = await speak(reply, opts.voiceId);
      playAudio(url);
      opts.onState("idle");
    } catch (err) {
      opts.onState("error", err instanceof Error ? err.message : String(err));
    } finally {
      busy = false;
    }
  }

  function playAudio(url: string): void {
    audioEl?.pause();
    audioEl = new Audio(url);
    audioEl.play().catch(() => {});
  }

  function cleanupStream(): void {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  return { start, stop };
}

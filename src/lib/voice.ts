// Jarvis voice pipeline client (client-side half). The ElevenLabs key never
// reaches the browser — TTS goes through the /api/elevenlabs/tts proxy.

/** Stream TTS audio for `text` and return an object URL ready for <audio>. */
export async function speak(text: string, voiceId?: string): Promise<string> {
  const qs = voiceId ? `?voiceId=${encodeURIComponent(voiceId)}` : ''
  const res = await fetch(`/api/elevenlabs/tts${qs}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(detail.error ?? `TTS failed (${res.status})`)
  }
  const blob = await res.blob()
  return URL.createObjectURL(blob)
}

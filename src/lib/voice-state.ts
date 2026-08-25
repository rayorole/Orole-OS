/**
 * Ambient voice state for the Orole-OS voice overlay.
 * Shared between the Web Speech engine, the UI, and the core reactor.
 */
export type VoiceAmbientState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error'

export interface SpeechSupport {
  stt: boolean
  tts: boolean
}

export function speechSupport(): SpeechSupport {
  const g = (
    typeof window !== 'undefined' ? window : globalThis
  ) as unknown as Record<string, unknown>
  if (!g) return { stt: false, tts: false }
  return {
    stt: 'SpeechRecognition' in g || 'webkitSpeechRecognition' in g,
    tts: 'speechSynthesis' in g,
  }
}

export function micPermission(): Promise<PermissionState | 'unsupported'> {
  if (typeof navigator === 'undefined' || !navigator.permissions?.query) {
    return Promise.resolve('unsupported')
  }
  return navigator.permissions
    .query({ name: 'microphone' as PermissionName })
    .then((status) => status.state)
    .catch(() => 'unsupported')
}

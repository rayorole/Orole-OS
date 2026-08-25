import { useCallback, useEffect, useRef, useState } from 'react'

export type VoiceOverlayState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'error'

interface SpeechRecognitionLike {
  lang: string
  interimResults: boolean
  continuous: boolean
  start: () => void
  stop: () => void
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onend: (() => void) | null
  onerror: ((event: unknown) => void) | null
}

/**
 * Voice overlay: push-to-talk bubble using the browser Speech APIs.
 * Mounts only when SpeechRecognition + speechSynthesis exist; the parent can
 * force-hide it with `enabled={false}`. All Speech APIs are injected lazily so
 * tests can mock them on window before mount.
 */
export function VoiceOverlay({ enabled = true }: { enabled?: boolean }) {
  const [state, setState] = useState<VoiceOverlayState>('idle')
  const [supported, setSupported] = useState(false)
  const [transcript, setTranscript] = useState('')
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)

  useEffect(() => {
    const w = window as unknown as Record<string, unknown>
    const Ctor = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as
      | (new () => SpeechRecognitionLike)
      | undefined
    if (!Ctor || !('speechSynthesis' in window)) return
    setSupported(true)

    const rec = new Ctor()
    rec.lang = 'en-US'
    rec.interimResults = false
    rec.continuous = false
    rec.onresult = (event) => {
      const text = event.results[0][0].transcript
      setTranscript(text)
      setState('speaking')
      const utterance = new SpeechSynthesisUtterance(`Heard: ${text}`)
      utterance.onend = () => setState('idle')
      window.speechSynthesis.speak(utterance)
    }
    rec.onerror = () => setState('error')
    rec.onend = () => setState((s) => (s === 'listening' ? 'idle' : s))
    recognitionRef.current = rec

    return () => {
      rec.onresult = null
      rec.onend = null
      rec.onerror = null
      try {
        rec.stop()
      } catch {
        /* already stopped */
      }
      window.speechSynthesis?.cancel()
      recognitionRef.current = null
    }
  }, [])

  const startListening = useCallback(() => {
    if (!recognitionRef.current) return
    setState('listening')
    try {
      recognitionRef.current.start()
    } catch {
      /* already started */
    }
  }, [])

  const stopListening = useCallback(() => {
    try {
      recognitionRef.current?.stop()
    } catch {
      /* not started */
    }
  }, [])

  if (!enabled || !supported) return null

  return (
    <div
      data-testid="voice-overlay"
      role="region"
      aria-label="Voice control"
      className="fixed bottom-6 right-6 z-50"
    >
      <button
        type="button"
        data-testid="voice-button"
        aria-pressed={state === 'listening'}
        onMouseDown={startListening}
        onMouseUp={stopListening}
        onTouchStart={startListening}
        onTouchEnd={stopListening}
        className="rounded-full border px-4 py-3 font-mono text-xs uppercase tracking-widest shadow-lg"
      >
        {state === 'idle' && 'hold to talk'}
        {state === 'listening' && 'listening…'}
        {state === 'speaking' && transcript && `“${transcript}”`}
        {state === 'error' && 'mic error'}
        {state === 'thinking' && 'thinking…'}
      </button>
    </div>
  )
}

export default VoiceOverlay

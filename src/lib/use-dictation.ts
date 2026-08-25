import { useCallback, useEffect, useRef, useState } from 'react'

interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onerror: ((event: Event & { error?: string }) => void) | null
  onend: (() => void) | null
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike

/**
 * Optional dictation hook: mic → text input via the Web Speech API.
 * Returns a `supported` flag so the UI can hide the mic button where
 * speech recognition is unavailable (e.g. Firefox, SSR).
 */
export function useDictation(options: { onFinalTranscript: (text: string) => void } = { onFinalTranscript: () => {} }) {
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Recognition instances accumulate state; keep one stable instance per hook.
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const finalRef = useRef(options.onFinalTranscript)
  finalRef.current = options.onFinalTranscript

  const supported =
    typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)

  useEffect(() => {
    if (!supported || recognitionRef.current) return
    const Ctor: SpeechRecognitionCtor | undefined =
      (window as unknown as { SpeechRecognition?: SpeechRecognitionCtor }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionCtor }).webkitSpeechRecognition
    if (!Ctor) return
    const recognition = new Ctor()
    recognition.lang = 'en-US'
    recognition.continuous = false
    recognition.interimResults = true
    recognition.onresult = (event) => {
      let finalText = ''
      let interimText = ''
      for (const result of event.results) {
        if (result.isFinal) finalText += result[0].transcript
        else interimText += result[0].transcript
      }
      setInterim(interimText || finalText)
      if (finalText.trim()) {
        finalRef.current(finalText.trim())
        setInterim('')
      }
    }
    recognition.onerror = (event) => {
      setError(event.error === 'not-allowed' ? 'Microphone access denied.' : 'Dictation failed.')
      setListening(false)
    }
    recognition.onend = () => {
      setListening(false)
      setInterim('')
    }
    recognitionRef.current = recognition
    return () => {
      recognition.onresult = null
      recognition.onerror = null
      recognition.onend = null
      try {
        recognition.stop()
      } catch {
        // already stopped
      }
      recognitionRef.current = null
    }
  }, [supported])

  const startListening = useCallback(() => {
    if (!recognitionRef.current || listening) return
    setError(null)
    try {
      recognitionRef.current.start()
      setListening(true)
    } catch {
      setError('Could not start dictation.')
    }
  }, [listening])

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop()
    setListening(false)
  }, [])

  return { supported, listening, interim, error, startListening, stopListening }
}

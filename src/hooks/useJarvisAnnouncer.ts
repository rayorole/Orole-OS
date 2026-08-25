// Rate-limited Jarvis TTS announcer for the status bar (#25).
// Wraps the existing voice pipeline (/api/elevenlabs/tts) with a minimum
// interval between spoken announcements so polling never causes spam.

import { useCallback, useEffect, useRef, useState } from 'react'
import { speak } from '../lib/voice'

const MIN_ANNOUNCE_INTERVAL_MS = 30_000

export function useJarvisAnnouncer(minIntervalMs = MIN_ANNOUNCE_INTERVAL_MS) {
  const [enabled, setEnabled] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const lastAnnouncedAt = useRef(0)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled

  const stop = useCallback(() => {
    audioRef.current?.pause()
    audioRef.current = null
    setSpeaking(false)
  }, [])

  /**
   * Speak `text` through the Jarvis voice pipeline. Silently skipped when
   * disabled or when the previous announcement was less than minIntervalMs ago.
   */
  const announce = useCallback(
    async (text: string): Promise<boolean> => {
      if (!enabledRef.current) return false
      const now = Date.now()
      if (now - lastAnnouncedAt.current < minIntervalMs) return false
      lastAnnouncedAt.current = now
      try {
        setSpeaking(true)
        const url = await speak(text)
        if (!enabledRef.current) {
          URL.revokeObjectURL(url)
          return false
        }
        const audio = new Audio(url)
        audioRef.current = audio
        audio.onended = () => {
          URL.revokeObjectURL(url)
          setSpeaking(false)
          audioRef.current = null
        }
        await audio.play()
        return true
      } catch {
        setSpeaking(false)
        return false
      }
    },
    [minIntervalMs],
  )

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      if (prev) stop()
      return !prev
    })
  }, [stop])

  useEffect(() => stop, [stop])

  return { enabled, speaking, announce, toggle }
}

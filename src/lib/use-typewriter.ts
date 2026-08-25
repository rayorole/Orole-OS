import { useEffect, useRef, useState } from 'react'

/**
 * useTypewriter — character-by-character reveal for newly streamed text.
 *
 * Returns the visible slice of `full` plus whether typing is still in
 * flight. New characters appended to `full` are queued and revealed at
 * `cps` chars/sec (rAF-driven, so it pauses with the tab). History is
 * rendered instantly: the first non-empty value skips animation.
 */
export function useTypewriter(full: string, opts?: { enabled?: boolean; cps?: number }) {
  const enabled = opts?.enabled ?? true
  const cps = opts?.cps ?? 240

  const [visible, setVisible] = useState(() => (enabled ? '' : full))
  const shownRef = useRef(enabled ? 0 : full.length)
  const rafRef = useRef<number | null>(null)
  const lastTsRef = useRef(0)

  useEffect(() => {
    if (!enabled) {
      shownRef.current = full.length
      setVisible(full)
      return
    }
    // First hydration: render history instantly, no slow replay of old text.
    if (shownRef.current === 0 && full.length > 0 && visible === '') {
      shownRef.current = full.length
      setVisible(full)
      return
    }
    if (full.length <= shownRef.current) return

    let cancelled = false
    const tick = (ts: number) => {
      if (cancelled) return
      const dt = lastTsRef.current ? (ts - lastTsRef.current) / 1000 : 0
      lastTsRef.current = ts
      const next = Math.min(full.length, Math.floor(shownRef.current + dt * cps) + 1)
      if (next !== shownRef.current) {
        shownRef.current = next
        setVisible(full.slice(0, next))
      }
      if (next < full.length) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      cancelled = true
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      lastTsRef.current = 0
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [full, enabled, cps])

  return { visible, typing: visible.length < full.length }
}

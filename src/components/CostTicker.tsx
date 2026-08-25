import { useEffect, useRef, useState } from 'react'

/**
 * Animated dollar count-up. Eases toward the target value on every change;
 * used by the #29 cost ticker so the total visibly "ticks up" live.
 */
export function useCountUp(target: number, durationMs = 600): number {
  const [value, setValue] = useState(target)
  const fromRef = useRef(target)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    const from = value
    if (from === target) return
    fromRef.current = performance.now()

    const step = (t: number) => {
      const p = Math.min(1, (t - fromRef.current) / durationMs)
      // ease-out cubic
      const eased = 1 - Math.pow(1 - p, 3)
      setValue(from + (target - from) * eased)
      if (p < 1) rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs])

  return value
}

export function formatUsd(n: number): string {
  return `$${n.toFixed(2)}`
}

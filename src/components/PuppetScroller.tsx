import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { TranscriptEntry } from '#/lib/puppet-reducer'

export type ConnState = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'offline'

import { PuppetRow } from './PuppetRow'

/**
 * Virtualized terminal scrollback for the puppet view.
 *
 * - Fixed row-height windowing (~28px rows), overscan absorbs drift.
 * - Auto-scroll to bottom while unlocked; any user scroll-up locks it.
 * - Floating "jump to bottom" button when locked.
 * - Reconnect banner while the SSE connection is degraded.
 * - Scrollback capped at `maxLines` (default 1000) by the caller's reducer
 *   state; this component additionally only renders the visible window.
 */
export function PuppetScroller({
  entries,
  conn,
  loadingHistory,
  height = '70vh',
  maxLines = 1000,
}: {
  entries: TranscriptEntry[]
  conn: ConnState
  loadingHistory?: boolean
  height?: string
  maxLines?: number
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [range, setRange] = useState({ start: 0, end: 40 })

  const ROW_H = 28
  const OVERSCAN = 12

  // Windowed rendering: recompute visible slice on scroll / length change.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const update = () => {
      const start = Math.max(0, Math.floor(el.scrollTop / ROW_H) - OVERSCAN)
      const visible = Math.ceil(el.clientHeight / ROW_H)
      setRange({
        start,
        end: Math.min(entries.length, start + visible + OVERSCAN * 2),
      })
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    return () => el.removeEventListener('scroll', update)
  }, [entries.length])

  // Scroll-lock on user scroll-up; unlock near bottom.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let lastTop = el.scrollTop
    const onScroll = () => {
      if (el.scrollTop < lastTop - 4) setAutoScroll(false)
      else if (el.scrollTop >= el.scrollHeight - el.clientHeight - 24) setAutoScroll(true)
      lastTop = el.scrollTop
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  // Auto-scroll to bottom on new entries while unlocked.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && autoScroll) el.scrollTop = el.scrollHeight
  }, [entries, autoScroll])

  const jumpToBottom = useCallback(() => setAutoScroll(true), [])

  return (
    <div className="relative rounded-md border border-white/10 bg-black/40" style={{ height }}>
      {(conn === 'reconnecting' || conn === 'offline' || conn === 'connecting') && (
        <div
          data-testid="reconnect-banner"
          className={cnBanner(conn)}
          role="status"
        >
          {conn === 'connecting'
            ? '◌ connecting to live stream…'
            : conn === 'reconnecting'
              ? '⟳ connection lost — reconnecting… (no events missed)'
              : '✕ stream offline — retrying…'}
        </div>
      )}

      <div ref={scrollRef} className="h-full overflow-y-auto py-2 font-mono text-[13px]">
        {loadingHistory && (
          <div className="px-3 py-1 text-[11px] text-muted-foreground">loading history…</div>
        )}
        {!loadingHistory && entries.length === 0 && (
          <div className="px-3 py-2 text-[11px] text-muted-foreground">
            no activity yet — waiting for agent events…
          </div>
        )}
        {/* Top spacer keeps virtualized rows at correct offset. */}
        <div style={{ height: range.start * ROW_H }} aria-hidden />
        {entries.slice(range.start, range.end).map((entry) => (
          <PuppetRow key={entry.key} entry={entry} animate />
        ))}
        {/* Bottom spacer. */}
        <div
          style={{ height: Math.max(0, (entries.length - range.end) * ROW_H) }}
          aria-hidden
        />
        <span data-testid="cap-marker" title={`scrollback capped at ${maxLines} lines`} />
      </div>

      {!autoScroll && (
        <button
          type="button"
          onClick={jumpToBottom}
          data-testid="jump-to-bottom"
          className="absolute bottom-4 right-4 rounded-full border border-neon-cyan/50 bg-black/80 px-3 py-1.5 text-[11px] text-neon-cyan shadow-lg hover:bg-neon-cyan/10"
        >
          ↓ jump to bottom ({entries.length})
        </button>
      )}
    </div>
  )
}

function cnBanner(conn: ConnState): string {
  if (conn === 'connecting')
    return 'absolute left-0 right-0 top-0 z-10 bg-amber-400/10 px-3 py-1 text-center text-[11px] text-amber-300'
  if (conn === 'offline')
    return 'absolute left-0 right-0 top-0 z-10 bg-destructive/15 px-3 py-1 text-center text-[11px] text-destructive'
  return 'absolute left-0 right-0 top-0 z-10 bg-amber-400/10 px-3 py-1 text-center text-[11px] text-amber-300'
}

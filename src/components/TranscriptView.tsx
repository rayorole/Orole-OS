import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ConnState, TranscriptEntry } from '#/lib/hermes'
import { TranscriptRow } from './TranscriptRow'

const ROW_OVERSCAN = 12

function formatTs(ts?: string): string {
  if (!ts) return ''
  const d = new Date(ts)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleTimeString([], { hour12: false })
}

const CONN_LABEL: Record<ConnState, string> = {
  idle: 'idle',
  connecting: 'connecting…',
  live: 'live',
  reconnecting: 'reconnecting…',
  offline: 'offline',
}

export interface TranscriptViewProps {
  entries: TranscriptEntry[]
  conn: ConnState
  loadingHistory?: boolean
  height?: string
}

/**
 * Terminal-style transcript panel: virtualized rows (windowed rendering over
 * a scroll container), auto-scroll with scroll-lock when the user scrolls up,
 * timestamps and a live/reconnecting/offline status indicator.
 */
export function TranscriptView({ entries, conn, loadingHistory, height = '60vh' }: TranscriptViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [range, setRange] = useState<{ start: number; end: number }>({
    start: 0,
    end: ROW_OVERSCAN * 2,
  })

  // Windowed rendering: recompute visible slice on scroll.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const update = () => {
      const rowH = 28 // approx row height; padding in overscan absorbs drift
      const start = Math.max(0, Math.floor(el.scrollTop / rowH) - ROW_OVERSCAN)
      const visible = Math.ceil(el.clientHeight / rowH)
      setRange({ start, end: Math.min(entries.length, start + visible + ROW_OVERSCAN * 2) })
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    return () => el.removeEventListener('scroll', update)
  }, [entries.length])

  // Scroll-lock: any user scroll-up disables auto-scroll.
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

  const spacerStyle = (px: number) => ({ height: px })

  return (
    <div className="relative flex flex-col overflow-hidden rounded-lg border border-neon-cyan/20 bg-black/40 font-mono text-[13px] shadow-[0_0_32px_var(--grid-glow)]">
      {/* Status bar */}
      <div className="flex items-center justify-between border-b border-neon-cyan/15 bg-background/60 px-3 py-1.5 text-[11px] uppercase tracking-widest">
        <span className="text-muted-foreground">
          transcript · {entries.length} entries
        </span>
        <ConnIndicator conn={conn} />
      </div>

      {/* Scroll area with windowed rows */}
      <div ref={scrollRef} style={{ height }} className="overflow-y-auto px-1 py-1">
        {loadingHistory && (
          <div className="px-3 py-2 text-muted-foreground">▍ loading history…</div>
        )}
        {!loadingHistory && entries.length === 0 && (
          <div className="px-3 py-6 text-center text-muted-foreground">
            no transcript data — select an agent/session or wait for a run
          </div>
        )}
        <div style={spacerStyle(range.start * 28)} aria-hidden />
        {entries.slice(range.start, range.end).map((e, i) => (
          <TranscriptRow key={e.key} entry={e} ts={formatTs(e.ts)} index={range.start + i} />
        ))}
        <div
          style={spacerStyle(Math.max(0, (entries.length - range.end) * 28))}
          aria-hidden
        />
      </div>

      {/* Scroll-lock hint */}
      {!autoScroll && (
        <button
          type="button"
          onClick={() => {
            setAutoScroll(true)
            const el = scrollRef.current
            if (el) el.scrollTop = el.scrollHeight
          }}
          className="absolute bottom-3 right-3 rounded border border-neon-cyan/40 bg-background/90 px-2 py-1 text-[11px] text-neon-cyan hover:bg-neon-cyan/10"
        >
          ↓ jump to latest (scroll locked)
        </button>
      )}
    </div>
  )
}

function ConnIndicator({ conn }: { conn: ConnState }) {
  const color =
    conn === 'live'
      ? 'text-emerald-400'
      : conn === 'reconnecting' || conn === 'connecting'
        ? 'text-amber-400'
        : conn === 'offline'
          ? 'text-destructive'
          : 'text-muted-foreground'
  const pulse = conn === 'live' ? 'animate-pulse' : ''
  return (
    <span className={`flex items-center gap-1.5 ${color}`}>
      <span className={`inline-block h-2 w-2 rounded-full ${pulse} bg-current`} />
      {CONN_LABEL[conn]}
    </span>
  )
}

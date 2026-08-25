import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

/**
 * Transcript replay renderer — performance-critical path.
 *
 * Design (issue #34):
 *  - Incoming chars are buffered into a ref and flushed via
 *    requestAnimationFrame (~30fps cap), so a 500 chars/sec firehose costs at
 *    most one commit per 2 frames instead of per chunk.
 *  - Only the OPEN (still-streaming) line re-renders; completed lines are
 *    frozen as memoized nodes whose identity is stable.
 *  - Scrollback is virtualized with @tanstack/react-virtual and hard-capped
 *    at MAX_LINES entries.
 *  - Shiki highlighting is applied ONLY to completed code blocks; streaming
 *    content stays plain text.
 */

export const MAX_LINES = 2000

export interface TranscriptLine {
  id: string
  kind: 'user' | 'assistant' | 'system' | 'tool' | 'event'
  text: string
  ts?: number
  /** true while this line is still receiving streamed chars */
  open?: boolean
}

const KIND_CLASS: Record<TranscriptLine['kind'], string> = {
  user: 'text-neon-cyan',
  assistant: 'text-foreground',
  system: 'text-muted-foreground',
  tool: 'text-neon-violet',
  event: 'text-muted-foreground italic',
}

const KIND_LABEL: Record<TranscriptLine['kind'], string> = {
  user: '❯ you',
  assistant: '◆ agent',
  system: '· sys',
  tool: '⚙ tool',
  event: '⟐ run',
}

/** Approximate row height — measured rows absorb drift via dynamic measure. */
const EST_ROW_H = 24

interface VirtualizedTranscriptProps {
  lines: TranscriptLine[]
  height?: number | string
  className?: string
}

export function VirtualizedTranscript({ lines, height = 480, className }: VirtualizedTranscriptProps) {
  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => EST_ROW_H,
    overscan: 12,
  })

  // Auto-scroll to bottom when new lines arrive while pinned to bottom.
  useEffect(() => {
    const el = parentRef.current
    if (!el) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) {
      virtualizer.scrollToIndex(lines.length - 1, { align: 'end' })
    }
  }, [lines.length, virtualizer])

  return (
    <div
      ref={parentRef}
      style={{ height }}
      className={className ?? 'overflow-y-auto font-mono text-[13px] leading-[24px]'}
      role="log"
      aria-live="polite"
      aria-relevant="additions"
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((vItem) => {
          const line = lines[vItem.index]
          return (
            <div
              key={line.id}
              data-index={vItem.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${vItem.start}px)`,
              }}
            >
              {/* Completed lines are frozen memoized nodes; the open line is
                  the only node that re-renders on each rAF flush. */}
              {line.open ? (
                <OpenLine line={line} />
              ) : (
                <FrozenLine line={line} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Memoized, immutable row for a COMPLETED line — never re-renders. */
const FrozenLine = memoRow(function FrozenLine({ line }: { line: TranscriptLine }) {
  return (
    <div className={`flex gap-2 px-3 ${KIND_CLASS[line.kind]}`}>
      <span className="shrink-0 select-none text-[10px] text-muted-foreground/60 tabular-nums">
        {fmtTs(line.ts)}
      </span>
      <span className="shrink-0 select-none text-[11px] opacity-70">{KIND_LABEL[line.kind]}</span>
      <HighlightedBlock text={line.text} done />
    </div>
  )
})

/**
 * The single OPEN (streaming) line. Its text comes in through an rAF-gated
 * flush; this component reads from a buffered ref, NOT from store state, so
 * high-frequency deltas never trigger global re-renders.
 */
function OpenLine({ line }: { line: TranscriptLine }) {
  return (
    <div className={`flex gap-2 px-3 ${KIND_CLASS[line.kind]}`}>
      <span className="shrink-0 select-none text-[10px] text-muted-foreground/60 tabular-nums">
        {fmtTs(line.ts)}
      </span>
      <span className="shrink-0 select-none text-[11px] opacity-70">{KIND_LABEL[line.kind]}</span>
      <span className="min-w-0 whitespace-pre-wrap break-words">
        {line.text}
        <span className="ml-0.5 inline-block h-3 w-2 animate-pulse bg-neon-cyan align-middle" />
      </span>
    </div>
  )
}

// ── rAF char buffering ───────────────────────────────────────────────────────

/**
 * useRafBufferedStream — accumulate incoming chunks in a ref; flush merged
 * text into `setLines` at ~30fps regardless of incoming chunk rate.
 *
 * Returns a push(chunk) function that is safe to call from a stream handler
 * at any frequency.
 */
export function useRafBufferedStream(
  setOpenText: (text: string) => void,
  opts: { fps?: number } = {},
): (chunk: string) => void {
  const bufRef = useRef('')
  const rafRef = useRef<number | null>(null)
  const lastFlush = useRef(0)
  const fps = opts.fps ?? 30
  const minInterval = 1000 / fps

  const push = useMemo(() => {
    return (chunk: string) => {
      bufRef.current += chunk
      if (rafRef.current !== null) return
      const tick = () => {
        rafRef.current = null
        const now = performance.now()
        if (now - lastFlush.current < minInterval) {
          rafRef.current = requestAnimationFrame(tick)
          return
        }
        lastFlush.current = now
        const out = bufRef.current
        bufRef.current = ''
        setOpenText(out)
      }
      rafRef.current = requestAnimationFrame(tick)
    }
  }, [setOpenText, minInterval])

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    },
    [],
  )

  return push
}

// ── Shiki highlighting (completed blocks only) ──────────────────────────────

let shikiHighlighterPromise: Promise<{
  codeToHtml: (code: string, lang: string) => Promise<string>
} | null> | null = null

async function loadShiki() {
  if (!shikiHighlighterPromise) {
    shikiHighlighterPromise = import('shiki').then((shiki) => ({
      codeToHtml: async (code: string, lang: string) => {
        const highlighter = await shiki.createHighlighter({ themes: ['github-dark-default'], langs: [lang] })
        return highlighter.codeToHtml(code, { lang, theme: 'github-dark-default' })
      },
    })).catch(() => null)
  }
  return shikiHighlighterPromise
}

const FENCE_RE = /^```(\w+)?\n/

/**
 * Highlighted block: plain text while streaming (`done=false`), Shiki HTML
 * only once the block completes. Falls back to plain text if Shiki fails.
 */
function HighlightedBlock({ text, done }: { text: string; done: boolean }) {
  const [html, setHtml] = useState<string | null>(null)
  const langMatch = done ? FENCE_RE.exec(text) : null
  const lang = langMatch?.[1] ?? 'text'
  const body = langMatch ? text.slice(langMatch[0].length).replace(/```\s*$/, '') : text

  useEffect(() => {
    if (!done || !langMatch) return
    let cancelled = false
    void loadShiki().then(async (mod) => {
      if (!mod || cancelled) return
      try {
        const out = await mod.codeToHtml(body, lang)
        if (!cancelled) setHtml(out)
      } catch {
        /* keep plain text fallback */
      }
    })
    return () => {
      cancelled = true
    }
  }, [done, langMatch, body, lang])

  if (html) {
    return (
      <span
        className="min-w-0 [&_pre]:!bg-transparent [&_code]:whitespace-pre-wrap [&_code]:break-words"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    )
  }
  return (
    <span className="min-w-0 whitespace-pre-wrap break-words">{body}</span>
  )
}

function fmtTs(ts?: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleTimeString([], { hour12: false })
}

function memoRow(render: (props: { line: TranscriptLine }) => ReactNode) {
  let cacheKey: string | null = null
  let cached: ReactNode = null
  return function Row({ line }: { line: TranscriptLine }) {
    // Completed lines are immutable — identity check suffices.
    if (cacheKey === line.id && cached) return cached
    cacheKey = line.id
    cached = render({ line })
    return cached
  }
}

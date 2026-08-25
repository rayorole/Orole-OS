// Per-agent Claude Code-style transcript drawer (extends issue #12 component
// spec): historical backfill + live SSE tail, slides over the dashboard grid.

import { useEffect, useRef } from 'react'
import { useTranscript } from './api'
import { PanelSkeleton } from './states'
import type { TranscriptMessage } from './types'

const ROLE_LABEL: Record<TranscriptMessage['role'], string> = {
  user: '❯ user',
  assistant: '● agent',
  system: '◇ system',
  tool: '⚙ tool',
}

const ROLE_STYLE: Record<TranscriptMessage['role'], string> = {
  user: 'text-neon-violet border-neon-violet/30 bg-neon-violet/5',
  assistant: 'text-neon-cyan border-neon-cyan/30 bg-neon-cyan/5',
  system: 'text-muted-foreground border-border/40',
  tool: 'text-amber-400/90 border-amber-400/20 bg-amber-400/5',
}

export function TranscriptDrawer({
  agentId,
  open,
  onClose,
}: {
  agentId: string | null
  open: boolean
  onClose: () => void
}) {
  const { messages, loading } = useTranscript(open ? agentId : null)
  const tailRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    tailRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  return (
    <div
      className={`fixed inset-y-0 right-0 z-50 w-full max-w-xl transform border-l border-neon-cyan/25 bg-background/95 shadow-[0_0_60px_rgba(0,255,255,0.08)] backdrop-blur transition-transform duration-300 ${
        open ? 'translate-x-0' : 'translate-x-full'
      }`}
      role="dialog"
      aria-label="Agent transcript"
      aria-hidden={!open}
    >
      <header className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            transcript drawer
          </p>
          <h2 className="font-mono text-lg text-neon-cyan">
            {agentId ?? '—'}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded px-3 py-1 font-mono text-xs uppercase tracking-widest text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          esc / close
        </button>
      </header>

      <div className="flex h-[calc(100%-57px)] flex-col overflow-y-auto p-4 font-mono text-sm">
        {loading && messages.length === 0 ? (
          <PanelSkeleton rows={6} />
        ) : messages.length === 0 ? (
          <p className="mt-10 text-center text-xs uppercase tracking-widest text-muted-foreground/60">
            no transcript frames — live tail will append here
          </p>
        ) : (
          <ol className="space-y-3">
            {messages.map((m) => (
              <li
                key={m.id}
                className={`rounded-lg border px-3 py-2 ${ROLE_STYLE[m.role]}`}
              >
                <div className="mb-1 flex items-center justify-between text-[11px] opacity-70">
                  <span>{ROLE_LABEL[m.role]}</span>
                  <span>{new Date(m.at).toLocaleTimeString()}</span>
                </div>
                <pre className="whitespace-pre-wrap break-words font-sans text-sm text-foreground/90">
                  {m.content}
                </pre>
              </li>
            ))}
            <div ref={tailRef} />
          </ol>
        )}
      </div>
    </div>
  )
}

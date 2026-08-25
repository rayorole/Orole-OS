import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { AgentSelector } from '#/components/AgentSelector'
import { PuppetScroller } from '#/components/PuppetScroller'
import type { HermesSession } from '#/lib/hermes'
import { usePuppetView } from '#/lib/use-puppet-view'

export const Route = createFileRoute('/puppet')({
  component: PuppetPage,
})

/**
 * Agent puppet view — click an agent, watch it work in a live terminal:
 * instant history hydration, character-by-character typing for new tokens,
 * collapsible tool chips with full JSON, idempotent reconnect.
 * Closes rayorole/Orole-OS#27. Shares the session-view surface with #12
 * (AgentSelector + hermes client + RunEventStream) rather than diverging.
 */
function PuppetPage() {
  const [session, setSession] = useState<HermesSession | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const { entries, conn, loadingHistory, maxLines } = usePuppetView(session, runId)

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 px-6 py-8">
      <header className="space-y-1">
        <p className="font-mono text-xs uppercase tracking-[0.35em] text-neon-violet">
          puppet view
        </p>
        <h1 className="bg-gradient-to-r from-neon-cyan via-foreground to-neon-violet bg-clip-text text-3xl font-bold text-transparent">
          Live Agent Terminal
        </h1>
      </header>

      <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-[300px_1fr]">
        <div className="flex min-w-0 flex-col gap-2">
          <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            select agent
          </p>
          <AgentSelector
            selectedId={session?.id ?? null}
            onSelect={(s) => {
              setSession(s)
              setRunId(null)
            }}
          />
        </div>

        <section className="flex min-w-0 flex-col gap-2">
          {session && (
            <form
              className="flex items-center gap-2 font-mono text-[12px]"
              onSubmit={(e) => {
                e.preventDefault()
                const fd = new FormData(e.currentTarget)
                setRunId(String(fd.get('runId') || '').trim() || null)
              }}
            >
              <label htmlFor="run-id" className="text-muted-foreground">
                run id
              </label>
              <input
                id="run-id"
                name="runId"
                placeholder="run_… (attach /v1/runs/{id}/events stream)"
                className="min-w-0 flex-1 rounded border border-neon-cyan/30 bg-black/40 px-2 py-1 text-neon-cyan placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-neon-cyan/50"
              />
              <button
                type="submit"
                className="rounded border border-neon-cyan/40 px-3 py-1 text-neon-cyan hover:bg-neon-cyan/10"
              >
                attach ▸
              </button>
              <span className={cnConn(conn as string)}>{conn}</span>
            </form>
          )}

          <PuppetScroller
            entries={entries}
            conn={conn}
            loadingHistory={loadingHistory}
            maxLines={maxLines}
          />
        </section>
      </div>
    </main>
  )
}

function cnConn(c: string): string {
  if (c === 'live') return 'text-emerald-400'
  if (c === 'reconnecting' || c === 'connecting') return 'text-amber-400'
  if (c === 'offline') return 'text-destructive'
  return 'text-muted-foreground'
}

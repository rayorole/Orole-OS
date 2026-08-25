import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { AgentSelector } from '#/components/AgentSelector'
import { TranscriptView } from '#/components/TranscriptView'
import type { HermesSession } from '#/lib/hermes'
import { useTranscript } from '#/lib/use-transcript'

export const Route = createFileRoute('/transcript')({
  component: TranscriptPage,
})

/**
 * Per-agent live transcript — Claude Code-style terminal panel.
 * Closes rayorole/Orole-OS#12.
 */
function TranscriptPage() {
  const [session, setSession] = useState<HermesSession | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const { entries, conn, loadingHistory } = useTranscript(session, runId)

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 px-6 py-8">
      <header className="space-y-1">
        <p className="font-mono text-xs uppercase tracking-[0.35em] text-neon-violet">
          live telemetry
        </p>
        <h1 className="bg-gradient-to-r from-neon-cyan via-foreground to-neon-violet bg-clip-text text-3xl font-bold text-transparent">
          Agent Transcript
        </h1>
      </header>

      <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-[300px_1fr]">
        <AgentSelector
          selectedId={session?.id ?? null}
          onSelect={(s) => {
            setSession(s)
            setRunId(null)
          }}
        />

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
                tail ▸
              </button>
            </form>
          )}

          <TranscriptView entries={entries} conn={conn} loadingHistory={loadingHistory} />
        </section>
      </div>
    </main>
  )
}

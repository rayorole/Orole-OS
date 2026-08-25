import { useCallback, useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'

import {
  ActivityStrip,
  AgentCards,
  AnalyticsSection,
  KanbanMirror,
  SessionsBrowser,
  TimeRangeSelector,
  TranscriptDrawer,
  useTimeRange,
} from '#/lib/dashboard'

export const Route = createFileRoute('/dashboard')({
  component: DashboardPage,
})

function DashboardPage() {
  const [drawerAgent, setDrawerAgent] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [range, setRange] = useTimeRange()

  const openTranscript = useCallback((agentId: string) => {
    setDrawerAgent(agentId)
    setDrawerOpen(true)
  }, [])

  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-4 py-8 md:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.35em] text-neon-violet">
            command center
          </p>
          <h1 className="bg-gradient-to-r from-neon-cyan via-foreground to-neon-violet bg-clip-text text-3xl font-bold text-transparent md:text-4xl">
            Full Agent Dashboard
          </h1>
        </div>
        <TimeRangeSelector value={range} onChange={setRange} />
      </header>

      <section aria-label="Agents">
        <AgentCards onOpenTranscript={openTranscript} />
      </section>

      <ActivityStrip />

      <div className="grid gap-6 xl:grid-cols-2">
        <KanbanMirror />
        <SessionsBrowser
          onOpenSession={(id) => {
            setDrawerAgent(id)
            setDrawerOpen(true)
          }}
        />
      </div>

      <AnalyticsSection range={range} />

      <TranscriptDrawer
        agentId={drawerAgent}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
    </main>
  )
}

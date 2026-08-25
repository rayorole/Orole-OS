import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { AgentActivityFeed } from '#/components/AgentActivityFeed'
import { FailureTriage } from '#/components/FailureTriage'
import { useActivityFeed } from '#/lib/activity-feed'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'

export const Route = createFileRoute('/')({
  component: Home,
})

/** Failure triage fed from the shared activity-feed store. */
function AgentActivityFeedWithTriage() {
  const { runs } = useActivityFeed()
  return <FailureTriage runs={runs} onOpenRun={(id) => (window.location.href = `/runs/${id}`)} />
}

function SystemStatus() {
  // Demonstrates TanStack Query wiring end-to-end.
  const { data } = useQuery({
    queryKey: ['system-time'],
    queryFn: () => Promise.resolve(new Date().toISOString()),
    refetchInterval: 1000,
  })

  return (
    <span className="font-mono text-neon-cyan/80">{data ?? 'booting…'}</span>
  )
}

function Home() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center gap-10 px-6 py-20">
      <div className="space-y-3 text-center">
        <p className="font-mono text-xs uppercase tracking-[0.35em] text-neon-violet">
          system online
        </p>
        <h1 className="bg-gradient-to-r from-neon-cyan via-foreground to-neon-violet bg-clip-text text-5xl font-bold text-transparent md:text-6xl">
          Orole-OS
        </h1>
        <p className="text-muted-foreground max-w-xl text-balance">
          A dark-sci-fi operating shell built on TanStack Start — SSR, typed
          routing, and server state in one rig.
        </p>
      </div>

      <AgentActivityFeed />
      <AgentActivityFeedWithTriage />

      <Card className="w-full border-neon-cyan/20 shadow-[0_0_32px_var(--grid-glow)]">
        <CardHeader>
          <CardTitle>Core Diagnostics</CardTitle>
          <CardDescription>All subsystems nominal.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="size-2 animate-pulse rounded-full bg-primary shadow-[0_0_8px_var(--neon-cyan)]" />
            <SystemStatus />
          </div>
          <Button variant="outline">Run Scan</Button>
        </CardContent>
      </Card>

      <div className="grid w-full gap-4 sm:grid-cols-3">
        {[
          { name: 'Router', desc: 'TanStack Router · file routes' },
          { name: 'Query', desc: 'TanStack Query · SSR-safe client' },
          { name: 'UI', desc: 'shadcn/ui · sci-fi tokens' },
        ].map((m) => (
          <Card key={m.name} className="gap-2 py-4">
            <CardHeader className="px-4">
              <CardTitle className="font-mono text-sm text-neon-cyan">
                {m.name}
              </CardTitle>
              <CardDescription className="text-xs">{m.desc}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
    </main>
  )
}

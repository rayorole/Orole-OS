import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Badge, StatusDot } from '#/components/ui/badge'

export const Route = createFileRoute('/')({
  component: MissionControl,
})

type Subsystem = {
  name: string
  desc: string
  status: 'running' | 'pending' | 'failed' | 'idle'
}

const SUBSYSTEMS: Subsystem[] = [
  { name: 'ROUTER', desc: 'Typed file routes · SSR', status: 'running' },
  { name: 'QUERY', desc: 'Server-state pipeline', status: 'running' },
  { name: 'AGENTS', desc: 'Awaiting wave-3 modules', status: 'pending' },
]

function Uptime() {
  // Live server clock — demonstrates the query wiring end-to-end.
  const { data } = useQuery({
    queryKey: ['system-time'],
    queryFn: () => Promise.resolve(new Date().toISOString()),
    refetchInterval: 1000,
  })

  return (
    <span className="font-mono text-sm text-neon-cyan/80">
      {data ?? 'booting…'}
    </span>
  )
}

function MissionControl() {
  return (
    <div className="hud-page flex flex-1 flex-col gap-8 py-14">
      <div className="space-y-2">
        <p className="hud-panel-title">mission control</p>
        <h1 className="bg-gradient-to-r from-neon-cyan via-foreground to-neon-violet bg-clip-text text-4xl font-bold text-transparent md:text-5xl">
          Orole-OS
        </h1>
        <p className="max-w-xl text-balance text-muted-foreground">
          Operating shell for the Orole agent fleet. Systems online —
          module dashboards land with wave 3.
        </p>
      </div>

      <Card className="border-primary/20 shadow-[0_0_32px_var(--grid-glow)]">
        <CardHeader>
          <CardTitle>Core Diagnostics</CardTitle>
          <CardDescription>All subsystems nominal.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <StatusDot status="running" />
            <Uptime />
          </div>
          <Button variant="outline" disabled>
            Run Scan
          </Button>
        </CardContent>
      </Card>

      <section aria-label="Subsystems" className="grid w-full gap-4 sm:grid-cols-3">
        {SUBSYSTEMS.map((m) => (
          <Card key={m.name} className="gap-3 py-4">
            <CardHeader className="px-4">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="font-mono text-sm text-neon-cyan">
                  {m.name}
                </CardTitle>
                <Badge variant={m.status}>{m.status}</Badge>
              </div>
              <CardDescription className="text-xs">{m.desc}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </section>
    </div>
  )
}

import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Radio } from 'lucide-react'

import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
<<<<<<< HEAD
import { PanelErrorBoundary } from '#/components/panel-error-boundary'
import { EmptyState, ErrorState, LoadingState, PanelState } from '#/components/states'
=======
import { Badge, StatusDot } from '#/components/ui/badge'
>>>>>>> 8ef481b (feat(ui): dark HUD design system, purge TanStack starter boilerplate)

export const Route = createFileRoute('/')({
  component: MissionControl,
})

<<<<<<< HEAD
const GATEWAY_BASE = 'https://os.orole.be'

/**
 * Single taxonomy mapping at the API-client level: raw fetch failures become
 * typed failure classes here; every panel below trusts classifyFailure.
 */
async function fetchJson(path: string, apiKey: string | null): Promise<unknown> {
  if (!apiKey) throw new (await import('#/lib/errors')).NoApiKeyError()
  let res: Response
  try {
    res = await fetch(`${GATEWAY_BASE}${path}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
  } catch {
    throw new (await import('#/lib/errors')).NetworkOrCorsError()
  }
  if (res.status === 401 || res.status === 403)
    throw new (await import('#/lib/errors')).AuthFailedError()
  if (res.status >= 500)
    throw new (await import('#/lib/errors')).ServerError(res.status)
  if (!res.ok) throw new Error(`Unexpected status ${res.status}`)
  return res.json()
}

function getApiKey(): string | null {
  try {
    return window.localStorage.getItem('orole.apiKey')
  } catch {
    return null
  }
}

/** Gateway reachability probe — the panel's primary async surface. */
function useGatewayStatus() {
  return useQuery({
    queryKey: ['gateway-status'],
    queryFn: () => fetchJson('/v1/models', getApiKey()),
    refetchInterval: 30_000,
    retry: false,
    enabled: typeof window !== 'undefined',
  })
}

function GatewayPanel() {
  const query = useGatewayStatus()
  return (
    <Card className="w-full border-neon-cyan/20 shadow-[0_0_32px_var(--grid-glow)]">
      <CardHeader>
        <CardTitle>Core Diagnostics</CardTitle>
        <CardDescription>Live link to os.orole.be.</CardDescription>
      </CardHeader>
      <CardContent>
        <PanelState
          query={query}
          isEmpty={() => false}
        >
          <div className="flex items-center gap-2">
            <span className="size-2 animate-pulse rounded-full bg-primary shadow-[0_0_8px_var(--neon-cyan)]" />
            <span className="font-mono text-neon-cyan/80">
              all subsystems nominal
            </span>
          </div>
        </PanelState>
      </CardContent>
    </Card>
  )
}

/** Run-history feed — demonstrates the inviting empty state. */
function ActivityFeed() {
  const query = useQuery({
    queryKey: ['activity-feed'],
    queryFn: () => fetchJson('/api/sessions', getApiKey()) as Promise<unknown[]>,
    refetchInterval: 15_000,
    retry: false,
    enabled: typeof window !== 'undefined',
  })

  return (
    <Card className="w-full border-neon-violet/20">
      <CardHeader>
        <CardTitle>Agent Activity</CardTitle>
        <CardDescription>Recent Hermes runs and session events.</CardDescription>
      </CardHeader>
      <CardContent>
        <PanelErrorBoundary region="activity-feed">
          <PanelState
            query={query}
            isEmpty={(data) => !Array.isArray(data) || data.length === 0}
            emptyTitle="no runs yet"
            emptyDescription="When your agents start working, live runs and session events stream into this feed."
            emptyAction={
              <Button asChild size="sm" variant="outline">
                <Link to="/about">Learn how it works</Link>
              </Button>
            }
          >
            <ul aria-live="polite" className="space-y-2 font-mono text-sm">
              {(Array.isArray(query.data) ? query.data : []).map((item, i) => (
                <li key={i} className="text-[var(--muted-foreground)]">
                  {typeof item === 'string' ? item : JSON.stringify(item)}
                </li>
              ))}
            </ul>
          </PanelState>
        </PanelErrorBoundary>
      </CardContent>
    </Card>
  )
}

/** Standalone error-state demo surface (renders each class explicitly). */
function StateShowcase() {
  const demo = new Error('demo')
  return (
    <div className="grid w-full gap-4 sm:grid-cols-2">
      <EmptyState
        icon={<Radio aria-hidden="true" className="size-6" />}
        title="signal clear"
        description="All feeds connected. This is the resting state of a healthy panel."
      />
      <LoadingState label="Scanning" rows={2} />
      {/* Rendered via ErrorState so each recovery message is exercised */}
      <div aria-live="polite">
        <ErrorState error={demo} retry={() => {}} onGoToSettings={() => {}} />
      </div>
    </div>
=======
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
>>>>>>> 8ef481b (feat(ui): dark HUD design system, purge TanStack starter boilerplate)
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

<<<<<<< HEAD
      <PanelErrorBoundary region="core-diagnostics">
        <GatewayPanel />
      </PanelErrorBoundary>

      <ActivityFeed />

      <StateShowcase />
    </main>
=======
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
>>>>>>> 8ef481b (feat(ui): dark HUD design system, purge TanStack starter boilerplate)
  )
}

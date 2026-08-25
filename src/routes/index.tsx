import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Radio } from 'lucide-react'

import { AgentActivityFeed } from '#/components/AgentActivityFeed'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { PanelErrorBoundary } from '#/components/panel-error-boundary'
import { EmptyState, ErrorState, LoadingState, PanelState } from '#/components/states'

export const Route = createFileRoute('/')({
  component: Home,
})

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

      <PanelErrorBoundary region="core-diagnostics">
        <GatewayPanel />
      </PanelErrorBoundary>

      <ActivityFeed />

      <StateShowcase />
    </main>
  )
}

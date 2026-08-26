import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { Button } from '#/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card'
import { Badge, StatusDot } from '#/components/ui/badge'
import { PanelErrorBoundary } from '#/components/panel-error-boundary'
import { PanelState } from '#/components/states'
import { FailureClass, classifyFailure } from '#/lib/errors'

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

/** Gateway reachability probe — shared by the status strip and the feed. */
function useGatewayStatus() {
  return useQuery({
    queryKey: ['gateway-status'],
    queryFn: () => fetchJson('/v1/models', getApiKey()),
    refetchInterval: 30_000,
    retry: false,
    enabled: typeof window !== 'undefined',
  })
}

/* ── Mission-control hero ──────────────────────────────────────────────── */

/**
 * Compact live status strip: gateway link + agent feed health at a glance.
 * Replaces the old standalone "Core Diagnostics" placeholder card.
 */
type StripStatus = 'running' | 'pending' | 'failed' | 'idle'

const STRIP_COPY: Record<StripStatus, string> = {
  running: 'gateway online · os.orole.be',
  pending: 'establishing uplink…',
  failed: 'uplink lost — check settings',
  idle: 'standby',
}

function stripStatus(query: {
  isPending: boolean
  isError: boolean
}): StripStatus {
  if (query.isPending) return 'pending'
  if (query.isError) return 'failed'
  return 'running'
}

function failureLabel(error: unknown): string {
  switch (classifyFailure(error)) {
    case FailureClass.NO_KEY:
      return 'no api key connected'
    case FailureClass.AUTH_FAILED:
      return 'api key rejected'
    case FailureClass.NETWORK_OR_CORS:
      return 'gateway unreachable'
    case FailureClass.SERVER_ERROR:
      return 'gateway server error'
    default:
      return 'unknown fault'
  }
}

function GatewayStatusStrip() {
  const query = useGatewayStatus()
  const status = stripStatus(query)
  const label =
    status === 'failed' ? failureLabel(query.error) : STRIP_COPY[status]

  return (
    <div
      data-testid="gateway-status-strip"
      className="inline-flex items-center gap-3 rounded-full border border-border bg-card/60 px-4 py-1.5 font-mono text-xs"
    >
      <StatusDot status={status} />
      <Badge variant={status} className="uppercase tracking-widest">
        {status}
      </Badge>
      <span aria-live="polite" className="text-muted-foreground">
        {label}
      </span>
    </div>
  )
}

function Hero() {
  return (
    <header className="flex flex-col items-center gap-6 text-center">
      <p className="hud-panel-title text-neon-cyan">mission control</p>
      <h1 className="text-5xl font-bold tracking-tight text-foreground md:text-6xl">
        Orole<span className="text-neon-cyan drop-shadow-[0_0_16px_var(--neon-cyan-glow,_transparent)]">-</span>
        OS
      </h1>
      <p className="max-w-xl text-balance text-muted-foreground">
        The operating shell for your agent fleet — live runs, costs, and
        control surfaces in one dark HUD.
      </p>
      <PanelErrorBoundary region="gateway-status">
        <GatewayStatusStrip />
      </PanelErrorBoundary>
    </header>
  )
}

/* ── Real activity feed ────────────────────────────────────────────────── */

/** Run-history feed — real sessions streamed from the gateway. */
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
                <Link to="/">Learn how it works</Link>
              </Button>
            }
          >
            <ul aria-live="polite" className="space-y-2 font-mono text-sm">
              {(Array.isArray(query.data) ? query.data : []).map((item, i) => (
                <li key={i} className="text-muted-foreground">
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

function Home() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center gap-10 px-6 py-20">
      <Hero />
      <ActivityFeed />
    </main>
  )
}

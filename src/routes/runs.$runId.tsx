import { useCallback, useEffect, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'

import { KillSwitchButtons, useRunControl } from '#/components/KillSwitch'
import { RunTraceInspector } from '#/components/RunTraceInspector'
import type { RawRunStep } from '#/lib/run-trace'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Badge } from '#/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { ScrollArea } from '#/components/ui/scroll-area'
import { Skeleton } from '#/components/ui/skeleton'
import { runsApiBase, HERMES_API_KEY } from '#/lib/run-control'

export const Route = createFileRoute('/runs/$runId')({
  component: RunDetail,
})

interface ApiRunDetail {
  id: string
  status?: string
  summary?: string
  /** Exact final prompt as sent to the model. */
  input?: string
  error?: string
  steps?: RawRunStep[]
}

async function fetchRun(runId: string): Promise<ApiRunDetail> {
  const res = await fetch(`${runsApiBase()}/v1/runs/${encodeURIComponent(runId)}`, {
    headers: HERMES_API_KEY ? { Authorization: `Bearer ${HERMES_API_KEY}` } : {},
  })
  if (!res.ok) throw new Error(`fetch run failed: HTTP ${res.status}`)
  return (await res.json()) as ApiRunDetail
}

function statusVariant(status: string): 'running' | 'failed' | 'pending' | 'idle' {
  if (status === 'failed' || status === 'cancelled') return 'failed'
  if (status === 'completed' || status === 'paused') return 'running'
  return 'pending'
}

function RunDetail() {
  const { runId } = Route.useParams()
  const [run, setRun] = useState<ApiRunDetail | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  // Optimistic status: flips instantly on a kill-switch action; the refetch
  // after settle re-asserts server truth.
  const [optimisticStatus, setOptimisticStatus] = useState<string | null>(null)

  useEffect(() => {
    let disposed = false
    setOptimisticStatus(null)
    fetchRun(runId)
      .then((r) => !disposed && setRun(r))
      .catch((e: Error) => !disposed && setLoadError(e.message))
    return () => {
      disposed = true
    }
  }, [runId])

  const control = useRunControl(() => {
    // After a settled action, re-fetch to reconcile with server truth.
    void fetchRun(runId)
      .then(setRun)
      .catch(() => {})
  })

  const executeWithOptimistic = useCallback(
    (id: string) => {
      const action = control.state.action
      return control.execute(id, () => {
        setOptimisticStatus(action === 'pause' ? 'paused' : 'cancelled')
      })
    },
    [control],
  )

  const status = optimisticStatus ?? run?.status ?? 'running'
  const actionable = status === 'running' || status === 'pending' || status === 'queued'

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-12">
      <Link
        to="/"
        className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-neon-cyan"
      >
        <ArrowLeft className="size-3" /> back to command center
      </Link>

      <Card className="w-full border-neon-violet/20">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="font-mono text-sm uppercase tracking-widest text-neon-cyan">
              Run {runId}
            </CardTitle>
            <div className="flex min-h-8 items-center gap-3">
              <Badge variant={statusVariant(status)}>{status}</Badge>
              {actionable && (
                <KillSwitchButtons
                  runId={runId}
                  control={control}
                  onExecute={executeWithOptimistic}
                />
              )}
            </div>
          </div>
          {run?.summary ? (
            <CardDescription>{run.summary}</CardDescription>
          ) : loadError ? (
            <CardDescription>—</CardDescription>
          ) : (
            <Skeleton className="h-4 w-2/3" />
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {(control.state.phase === 'confirm' || control.state.phase === 'pending') &&
            actionable && (
              <div role="status" aria-live="polite" className="sr-only">
                {control.state.phase === 'confirm'
                  ? `Confirm ${control.state.action} of run ${runId}`
                  : 'Applying kill switch action'}
              </div>
            )}
          {control.state.phase === 'error' && (
            <KillSwitchButtons runId={runId} control={control} />
          )}
          {!run && !loadError && (
            <div className="space-y-2">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5" />
            </div>
          )}
          {loadError && (
            <Alert variant="destructive">
              <AlertTitle>{loadError}</AlertTitle>
              <AlertDescription>
                Could not load run details — the API may be unreachable.
              </AlertDescription>
            </Alert>
          )}
          {run?.input && (
            <div>
              <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                exact final prompt as sent
              </p>
              <ScrollArea className="max-h-40 rounded-md border border-border bg-muted/40">
                <pre
                  data-testid="final-prompt"
                  className="whitespace-pre-wrap break-words p-3 text-[11px]"
                >
                  {run.input}
                </pre>
              </ScrollArea>
            </div>
          )}
          {run?.error && (
            <Alert variant="destructive" className="border-destructive/40 bg-destructive/10">
              <AlertTitle>error</AlertTitle>
              <AlertDescription className="font-mono text-xs">
                {run.error}
              </AlertDescription>
            </Alert>
          )}
          <div>
            <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
              trace — prompt → tool calls → results
            </p>
            <RunTraceInspector runId={runId} rawSteps={run?.steps ?? []} />
          </div>
        </CardContent>
      </Card>
    </main>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'

import { KillSwitchButtons, useRunControl } from '#/components/KillSwitch'
import { RunTraceInspector } from '#/components/RunTraceInspector'
import type { RawRunStep } from '#/lib/run-trace'
import { Badge } from '#/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
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
              <Badge
                className={
                  status === 'failed' || status === 'cancelled'
                    ? 'border-red-500/40 text-red-300'
                    : status === 'completed' || status === 'paused'
                      ? 'border-emerald-500/40 text-emerald-300'
                      : 'border-neon-cyan/40 text-neon-cyan'
                }
              >
                {status}
              </Badge>
              {actionable && (
                <KillSwitchButtons
                  runId={runId}
                  control={control}
                  onExecute={executeWithOptimistic}
                />
              )}
            </div>
          </div>
          <CardDescription>{run?.summary ?? (loadError ? '—' : 'loading…')}</CardDescription>
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
          {loadError && (
            <p role="alert" className="font-mono text-xs text-red-400">
              {loadError}
            </p>
          )}
          {run?.input && (
            <div>
              <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                exact final prompt as sent
              </p>
              <pre
                data-testid="final-prompt"
                className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-black/40 p-2 text-[11px]"
              >
                {run.input}
              </pre>
            </div>
          )}
          {run?.error && (
            <p className="font-mono text-xs text-red-300">error: {run.error}</p>
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

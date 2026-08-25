import { useEffect, useState } from 'react'
import { Activity, AlertCircle, CheckCircle2, Loader2, RadioTower } from 'lucide-react'

import { Badge } from '#/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { activityFeed, useActivityFeed, type RunRecord } from '#/lib/activity-feed'
import { KillSwitchButtons, useRunControl } from '#/components/KillSwitch'

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString()
}

function formatElapsed(record: RunRecord, now: number): string {
  const end = record.endedAt ?? now
  const secs = Math.max(0, Math.round((end - record.startedAt) / 1000))
  if (secs < 60) return `${secs}s`
  return `${Math.floor(secs / 60)}m ${secs % 60}s`
}

function StatusGlyph({ status }: { status: RunRecord['status'] }) {
  if (status === 'failed')
    return <AlertCircle className="size-4 shrink-0 text-red-400" aria-label="failed" />
  if (status === 'completed')
    return (
      <CheckCircle2 className="size-4 shrink-0 text-emerald-400" aria-label="completed" />
    )
  return (
    <Loader2
      className="size-4 shrink-0 animate-spin text-neon-cyan"
      aria-label="running"
    />
  )
}

function RunEntry({ record, now }: { record: RunRecord; now: number }) {
  const [open, setOpen] = useState(false)
  const failed = record.status === 'failed'
  const control = useRunControl()
  const actionable = record.status === 'running'

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
          failed
            ? 'border-red-500/30 bg-red-500/5 hover:bg-red-500/10'
            : 'border-border/50 hover:border-neon-cyan/30 hover:bg-neon-cyan/5'
        }`}
      >
        <div className="flex items-center gap-2">
          <StatusGlyph status={record.status} />
          <span className="min-w-0 flex-1 truncate font-mono text-sm">
            {record.summary}
          </span>
          <span className="font-mono text-xs text-muted-foreground">
            {formatElapsed(record, now)}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 pl-6 font-mono text-[11px] text-muted-foreground">
          <span>{formatTime(record.startedAt)}</span>
          <Badge
            className={
              failed
                ? 'border-red-500/40 text-red-300'
                : record.status === 'completed'
                  ? 'border-emerald-500/40 text-emerald-300'
                  : 'border-neon-cyan/40 text-neon-cyan'
            }
          >
            {record.status}
          </Badge>
          <a
            href={`/runs/${record.id}`}
            onClick={(e) => e.stopPropagation()}
            className="ml-auto hover:text-neon-cyan"
          >
            trace →
          </a>
        </div>
        {open && (
          <div className="mt-2 space-y-1 border-t border-border/40 pt-2 pl-6 text-xs">
            {record.input && (
              <p className="text-muted-foreground">
                <span className="font-mono text-neon-violet">input:</span>{' '}
                {record.input}
              </p>
            )}
            {failed && record.error && (
              <p className="text-red-300">
                <span className="font-mono">error:</span> {record.error}
              </p>
            )}
            {!record.error && failed && (
              <p className="text-red-300 font-mono">error: (no detail provided)</p>
            )}
            {actionable && (
              <div className="pt-1">
                <KillSwitchButtons
                  runId={record.id}
                  control={control}
                  onExecute={(id) =>
                    control.execute(id, () => {
                      // Optimistic: mark cancelled/paused locally; SSE truth re-syncs.
                      const action = control.state.action
                      activityFeed.upsert({
                        ...record,
                        status: action === 'pause' ? 'completed' : 'completed',
                        endedAt: record.endedAt ?? Date.now(),
                        summary:
                          action === 'pause'
                            ? `${record.summary} (paused)`
                            : `${record.summary} (cancelling…)`,
                      })
                    })
                  }
                />
              </div>
            )}
          </div>
        )}
      </button>
    </li>
  )
}

export function AgentActivityFeed() {
  const { runs, connection } = useActivityFeed()
  // Ticks elapsed timers for running entries.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  return (
    <Card className="w-full border-neon-violet/20 shadow-[0_0_32px_var(--grid-glow)]">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 font-mono text-sm uppercase tracking-widest text-neon-cyan">
            <RadioTower className="size-4" /> Agent Activity
          </CardTitle>
          <span
            aria-live="polite"
            className={`font-mono text-[11px] ${
              connection === 'connected' ? 'text-emerald-400' : 'text-amber-400'
            }`}
          >
            {connection === 'connected' ? '● live' : '◌ reconnecting…'}
          </span>
        </div>
        <CardDescription>
          Live Hermes run stream — newest first.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {runs.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
            <Activity className="size-6 opacity-50" />
            <p className="font-mono text-xs uppercase tracking-widest">
              no agent runs yet — standing by
            </p>
          </div>
        ) : (
          <ul className="max-h-96 space-y-1.5 overflow-y-auto pr-1">
            {runs.map((record) => (
              <RunEntry key={record.id} record={record} now={now} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

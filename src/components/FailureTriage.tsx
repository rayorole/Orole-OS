import { useMemo } from 'react'
import { ShieldAlert } from 'lucide-react'

import type { RunRecord } from '#/lib/activity-feed'
import { groupFailedRuns } from '#/lib/failure-groups'
import { Badge } from '#/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'

function formatWhen(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(ms).toLocaleDateString()
}

/**
 * Failure triage lite — failed runs grouped by normalized error signature,
 * with count + last occurrence and links to each run's trace view.
 */
export function FailureTriage({
  runs,
  onOpenRun,
}: {
  runs: RunRecord[]
  onOpenRun?: (runId: string) => void
}) {
  const groups = useMemo(() => groupFailedRuns(runs), [runs])

  return (
    <Card className="w-full border-red-500/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-mono text-sm uppercase tracking-widest text-red-300">
          <ShieldAlert className="size-4" /> Failure Triage
        </CardTitle>
        <CardDescription>
          Failed runs grouped by error signature.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {groups.length === 0 ? (
          <p className="py-6 text-center font-mono text-xs text-muted-foreground">
            no failures — fleet clean
          </p>
        ) : (
          <ul className="space-y-1.5">
            {groups.map((g) => (
              <li
                key={g.signature}
                className="rounded-md border border-red-500/25 bg-red-500/5 px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <Badge className="border-red-500/40 text-red-300">×{g.count}</Badge>
                  <span
                    className="min-w-0 flex-1 truncate font-mono text-xs text-foreground/90"
                    title={g.sampleMessage}
                  >
                    {g.sampleMessage}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                    last: {formatWhen(g.lastOccurredAt)}
                  </span>
                </div>
                {onOpenRun && (
                  <div className="mt-1 flex flex-wrap gap-1 pl-9">
                    {g.runIds.map((id) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => onOpenRun(id)}
                        className="rounded border border-border/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:border-neon-cyan/40 hover:text-neon-cyan"
                      >
                        run {id}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

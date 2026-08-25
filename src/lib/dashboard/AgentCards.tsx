// Agent cards grid — live status, current task, last-active per agent.

import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import { useAgents } from './api'
import { CardGridSkeleton, EmptyState, ErrorState } from './states'
import type { AgentStatus } from './types'

const STATUS_STYLE: Record<AgentStatus, string> = {
  idle: 'bg-slate-400 text-slate-300',
  running: 'bg-emerald-400 text-emerald-300',
  thinking: 'bg-amber-400 text-amber-300',
  offline: 'bg-zinc-600 text-zinc-400',
}

function relative(iso: string | null): string {
  if (!iso) return 'never'
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export function AgentCards({
  onOpenTranscript,
}: {
  onOpenTranscript: (agentId: string) => void
}) {
  const { data, loading, error } = useAgents()

  if (loading && !data) return <CardGridSkeleton />
  if (error) return <ErrorState message={error} />
  const agents = data ?? []
  if (agents.length === 0)
    return <EmptyState title="no agents online" hint="Connect a Hermes gateway to populate the fleet." />

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {agents.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => onOpenTranscript(a.id)}
          className="group text-left outline-none focus-visible:ring-2 focus-visible:ring-neon-cyan/50 rounded-xl"
          aria-label={`Open transcript for ${a.name}`}
        >
          <Card className="h-full border-neon-cyan/10 transition-colors group-hover:border-neon-cyan/40">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="font-mono text-base">{a.name}</CardTitle>
                <span className="flex items-center gap-1.5 font-mono text-[11px] uppercase">
                  <span
                    className={`size-2 animate-pulse rounded-full ${STATUS_STYLE[a.status]}`}
                  />
                  {a.status}
                </span>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="text-muted-foreground line-clamp-2 min-h-10">
                {a.currentTask ?? (
                  <span className="italic opacity-60">no active task</span>
                )}
              </p>
              <p className="font-mono text-[11px] text-muted-foreground/70">
                last active · {relative(a.lastActiveAt)}
              </p>
            </CardContent>
          </Card>
        </button>
      ))}
    </div>
  )
}

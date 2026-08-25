// Activity feed strip (extends issue #5 SSE feed spec), embedded in the
// dashboard shell as a horizontal strip.

import { useActivityFeed } from './api'
import { EmptyState, PanelSkeleton, PanelShell } from './states'

export function ActivityStrip() {
  const { events, connected } = useActivityFeed(30)

  return (
    <PanelShell
      title="activity"
      subtitle={connected ? 'live · sse connected' : 'idle · awaiting stream'}
      actions={
        <span
          className={`size-2 rounded-full ${
            connected ? 'animate-pulse bg-emerald-400' : 'bg-zinc-600'
          }`}
          aria-label={connected ? 'stream live' : 'stream offline'}
        />
      }
    >
      {!events.length ? (
        <div className="space-y-2">
          {connected ? (
            <PanelSkeleton rows={2} />
          ) : (
            <EmptyState
              title="no activity yet"
              hint="The SSE feed will populate this strip in real time."
            />
          )}
        </div>
      ) : (
        <ul className="flex gap-3 overflow-x-auto pb-1">
          {events.map((e) => (
            <li
              key={e.id}
              className="min-w-56 shrink-0 rounded-lg border border-neon-violet/20 bg-neon-violet/5 px-3 py-2 text-xs"
            >
              <div className="mb-0.5 flex items-center justify-between font-mono text-[10px] uppercase tracking-widest">
                <span className="text-neon-violet">{e.agentName}</span>
                <span className="text-muted-foreground/60">
                  {new Date(e.at).toLocaleTimeString()}
                </span>
              </div>
              <p className="line-clamp-2">{e.message}</p>
              <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/50">
                {e.kind}
              </p>
            </li>
          ))}
        </ul>
      )}
    </PanelShell>
  )
}

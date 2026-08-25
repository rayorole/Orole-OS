// Read-only kanban board mirror with live refresh where the API allows.

import { useKanbanBoard } from './api'
import { EmptyState, ErrorState, PanelSkeleton, PanelShell } from './states'
import type { KanbanColumn } from './types'

export function KanbanMirror() {
  const { data, loading, error } = useKanbanBoard()

  return (
    <PanelShell title="kanban mirror" subtitle="read-only · shared board">
      {loading && !data ? (
        <PanelSkeleton rows={4} />
      ) : error ? (
        <ErrorState message={error} />
      ) : (data ?? []).length === 0 ? (
        <EmptyState
          title="board unreachable"
          hint="Connect a gateway exposing /api/kanban/board."
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {(data as KanbanColumn[]).map((col) => (
            <div
              key={col.id}
              className="rounded-lg border border-border/50 bg-muted/20 p-3"
            >
              <h3 className="mb-2 font-mono text-[11px] uppercase tracking-widest text-neon-violet/80">
                {col.name}
                <span className="ml-1 text-muted-foreground">
                  ({col.cards.length})
                </span>
              </h3>
              <ul className="space-y-2">
                {col.cards.map((c) => (
                  <li
                    key={c.id}
                    className="rounded border border-border/40 bg-card px-2 py-1.5 text-xs"
                  >
                    <p className="line-clamp-2">{c.title}</p>
                    <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/60">
                      {c.assignee ?? 'unassigned'}
                    </p>
                  </li>
                ))}
                {col.cards.length === 0 && (
                  <li className="py-2 text-center font-mono text-[10px] uppercase text-muted-foreground/40">
                    empty
                  </li>
                )}
              </ul>
            </div>
          ))}
        </div>
      )}
    </PanelShell>
  )
}

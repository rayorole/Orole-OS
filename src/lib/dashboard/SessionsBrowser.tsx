// Sessions browser: searchable / filterable list with open-in-transcript.

import { useMemo, useState } from 'react'
import { useSessions } from './api'
import { EmptyState, ErrorState, PanelSkeleton, PanelShell } from './states'

export function SessionsBrowser({
  onOpenSession,
}: {
  onOpenSession: (sessionId: string) => void
}) {
  const { data, loading, error } = useSessions()
  const [q, setQ] = useState('')
  const [agentFilter, setAgentFilter] = useState('all')

  const sessions = data ?? []
  const agentIds = useMemo(
    () => Array.from(new Set(sessions.map((s) => s.agentId))).sort(),
    [sessions],
  )
  const filtered = sessions.filter((s) => {
    if (agentFilter !== 'all' && s.agentId !== agentFilter) return false
    if (!q.trim()) return true
    return s.title.toLowerCase().includes(q.toLowerCase())
  })

  return (
    <PanelShell title="sessions" subtitle={`${filtered.length} of ${sessions.length}`}>
      {loading && !data ? (
        <PanelSkeleton rows={5} />
      ) : error ? (
        <ErrorState message={error} />
      ) : sessions.length === 0 ? (
        <EmptyState
          title="no sessions"
          hint="Sessions appear once a gateway is connected."
        />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="search sessions…"
              className="min-w-48 flex-1 rounded-md border border-border/60 bg-input/40 px-3 py-1.5 font-mono text-sm outline-none placeholder:text-muted-foreground/50 focus:border-neon-cyan/40"
              aria-label="Search sessions"
            />
            <select
              value={agentFilter}
              onChange={(e) => setAgentFilter(e.target.value)}
              className="rounded-md border border-border/60 bg-input/40 px-2 py-1.5 font-mono text-sm outline-none focus:border-neon-cyan/40"
              aria-label="Filter by agent"
            >
              <option value="all">all agents</option>
              {agentIds.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </div>
          {filtered.length === 0 ? (
            <EmptyState title="no matches" hint="Adjust search or filter." />
          ) : (
            <ul className="max-h-72 divide-y divide-border/40 overflow-y-auto rounded-lg border border-border/40">
              {filtered.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => onOpenSession(s.id)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-muted/40"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm">{s.title}</p>
                      <p className="font-mono text-[11px] text-muted-foreground/60">
                        {s.agentId} · {s.messageCount} msgs ·{' '}
                        {new Date(s.lastMessageAt).toLocaleString()}
                      </p>
                    </div>
                    <span className="shrink-0 font-mono text-[10px] uppercase tracking-widest text-neon-cyan/70">
                      open →
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </PanelShell>
  )
}

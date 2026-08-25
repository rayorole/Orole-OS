import { useQuery } from '@tanstack/react-query'
import { fetchSessions, type HermesSession } from '#/lib/hermes'

/**
 * Agent/profile selector — lists Hermes sessions (one row per profile/agent
 * session) and highlights the active one.
 */
export function AgentSelector({
  selectedId,
  onSelect,
}: {
  selectedId: string | null
  onSelect: (s: HermesSession) => void
}) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['hermes-sessions'],
    queryFn: fetchSessions,
    refetchInterval: 15000,
    staleTime: 10000,
  })

  return (
    <div className="flex min-h-0 flex-col rounded-lg border border-neon-cyan/20 bg-black/40 font-mono">
      <div className="flex items-center justify-between border-b border-neon-cyan/15 px-3 py-1.5 text-[11px] uppercase tracking-widest text-muted-foreground">
        <span>agents / sessions</span>
        <button
          type="button"
          onClick={() => void refetch()}
          className="text-neon-cyan hover:text-foreground"
          aria-label="refresh sessions"
        >
          ⟳
        </button>
      </div>
      <div className="max-h-[60vh] overflow-y-auto p-1">
        {isLoading && (
          <div className="px-3 py-3 text-muted-foreground">▍ scanning fleet…</div>
        )}
        {isError && (
          <div className="px-3 py-3 text-destructive">
            ✗ gateway unreachable — is the Hermes API server running?
          </div>
        )}
        {data && data.length === 0 && (
          <div className="px-3 py-3 text-muted-foreground">no sessions found</div>
        )}
        {data?.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onSelect(s)}
            className={[
              'flex w-full flex-col items-start gap-0.5 rounded px-3 py-2 text-left transition-colors',
              s.id === selectedId
                ? 'bg-neon-cyan/10 ring-1 ring-inset ring-neon-cyan/40'
                : 'hover:bg-white/5',
            ].join(' ')}
          >
            <span className="w-full truncate text-[13px] text-foreground">
              <span className="text-neon-cyan">❯</span>{' '}
              {s.title || s.id}
            </span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {s.id}
              {s.source ? ` · ${s.source}` : ''}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

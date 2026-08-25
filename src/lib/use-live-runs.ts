import { useSyncExternalStore } from 'react'

const EMPTY: LiveRun[] = []

/**
 * Live run-completion feed for the heatmap.
 *
 * Transport-agnostic store: callers push parsed SSE events in via `applyEvent`
 * and hydrate history via `setRuns`. Today's cell subscribes through
 * `useTodayRuns` and updates without refresh as runs finish. This seam lets
 * tests drive scripted sequences with no network at all.
 */

export interface LiveRun {
  id: string
  status?: string
  /** Epoch ms of completion, when known. */
  endedAt: number | null
}

export type RunLiveEvent =
  | { event: 'run.completed'; data: { id: string; status?: string; endedAt?: string | number | null } }
  | { event: 'run.updated'; data: { id: string; status?: string; endedAt?: string | number | null } }
  | { event: 'run.started'; data: { id: string; status?: string; endedAt?: string | number | null } }

function toMs(v: string | number | null | undefined): number | null {
  if (v == null) return null
  const ms = typeof v === 'number' ? v : Date.parse(v)
  return Number.isFinite(ms) ? ms : null
}

class LiveRunStore {
  private runs = new Map<string, LiveRun>()
  private listeners = new Set<() => void>()
  private snapshot: LiveRun[] = []

  private emit() {
    this.snapshot = [...this.runs.values()]
    for (const l of this.listeners) l()
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): LiveRun[] => this.snapshot

  /** SSR-stable snapshot (always empty on the server). */
  getServerSnapshot = (): LiveRun[] => EMPTY

  /** Seed with historical runs (REST catch-up). */
  setRuns(runs: LiveRun[]) {
    for (const r of runs) this.runs.set(r.id, r)
    this.emit()
  }

  /** Apply one SSE lifecycle event; upserts by run id. */
  applyEvent(ev: RunLiveEvent) {
    if (!ev?.data?.id) return
    const prev = this.runs.get(ev.data.id)
    const next: LiveRun = {
      id: ev.data.id,
      status: ev.data.status ?? prev?.status,
      endedAt:
        toMs(ev.data.endedAt) ?? (ev.event === 'run.started' ? null : prev?.endedAt ?? null),
    }
    // Only completed/failed runs carry a finished time worth counting.
    if (ev.event === 'run.started' && next.endedAt == null && !next.status) return
    this.runs.set(next.id, next)
    this.emit()
  }
}

/** App-wide singleton so the heatmap and any future consumers share one stream. */
export const liveRunStore = new LiveRunStore()

/** Subscribe React to the live run list. */
export function useLiveRuns(): LiveRun[] {
  return useSyncExternalStore(
    liveRunStore.subscribe,
    liveRunStore.getSnapshot,
    liveRunStore.getServerSnapshot,
  )
}

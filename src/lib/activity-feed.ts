import { useSyncExternalStore } from 'react'

/**
 * Agent activity feed — transport-agnostic store for the Runs API SSE stream.
 *
 * The store knows nothing about EventSource: callers push parsed events in via
 * `applyEvent`, and hydration (catch-up on reconnect) happens through
 * `hydrate`. This seam is what lets tests drive scripted event sequences with
 * no network at all.
 */

export type RunStatus = 'running' | 'completed' | 'failed'

export interface RunRecord {
  id: string
  status: RunStatus
  /** Epoch ms — normalized to local time at the boundary. */
  startedAt: number
  endedAt: number | null
  /** One-line summary of what the run is doing. */
  summary: string
  /** Short input preview, shown in the expanded detail view. */
  input?: string
  /** Error message when status === 'failed'. */
  error?: string
}

/** Parsed SSE payload for a run lifecycle event. */
export interface RunEvent {
  event: 'run.started' | 'run.updated' | 'run.completed'
  data: {
    id: string
    status?: string
    startedAt?: string | number
    endedAt?: string | number | null
    summary?: string
    input?: string
    error?: string
  }
}

export type ConnectionStatus = 'connected' | 'reconnecting' | 'offline'

const MAX_HISTORY = 100

function toMs(value: string | number | null | undefined): number | null {
  if (value == null) return null
  const ms = typeof value === 'number' ? value : Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

export function normalizeRunEvent(raw: RunEvent): RunRecord {
  const d = raw.data
  let status: RunStatus = 'running'
  if (
    raw.event === 'run.completed' ||
    d.status === 'completed' ||
    d.status === 'failed' ||
    d.status === 'succeeded' ||
    d.status === 'error'
  ) {
    if (d.status === 'failed' || d.status === 'error') status = 'failed'
    else if (raw.event !== 'run.completed' || d.status) status = 'completed'
  }
  const startedAt = toMs(d.startedAt) ?? Date.now()
  const endedAt =
    raw.event === 'run.completed' ? (toMs(d.endedAt) ?? Date.now()) : toMs(d.endedAt)
  return {
    id: d.id,
    status,
    startedAt,
    endedAt,
    summary: d.summary ?? `Run ${d.id}`,
    input: d.input,
    error: raw.event === 'run.completed' && status === 'failed' ? d.error : undefined,
  }
}

export class ActivityFeedStore {
  private runs = new Map<string, RunRecord>()
  private orderedIds: string[] = []
  private listeners = new Set<() => void>()
  private snapshotCache: RunRecord[] = []
  private connection: ConnectionStatus = 'offline'

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getRunsSnapshot = (): RunRecord[] => this.snapshotCache

  getConnectionSnapshot = (): ConnectionStatus => this.connection

  private emit() {
    // Newest first, bounded history.
    this.orderedIds = [...this.runs.values()]
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, MAX_HISTORY)
      .map((r) => r.id)
    this.snapshotCache = this.orderedIds.map((id) => this.runs.get(id)!)
    for (const l of this.listeners) l()
  }

  setConnection(status: ConnectionStatus) {
    if (this.connection !== status) {
      this.connection = status
      this.emit()
    }
  }

  /** Upsert a run record from a live or replayed event. */
  upsert(record: RunRecord) {
    const existing = this.runs.get(record.id)
    this.runs.set(record.id, { ...existing, ...record })
    this.emit()
  }

  applyEvent(raw: RunEvent) {
    this.upsert(normalizeRunEvent(raw))
  }

  /** Catch-up after reconnect: merge REST-fetched history, then live deltas resume. */
  hydrate(records: RunRecord[]) {
    for (const r of records) {
      // Live events already applied win over stale REST snapshots.
      if (!this.runs.has(r.id)) this.runs.set(r.id, r)
    }
    this.emit()
  }

  reset() {
    this.runs.clear()
    this.orderedIds = []
    this.snapshotCache = []
    this.connection = 'offline'
    this.emit()
  }
}

/**
 * Singleton feed + connection state, shared app-wide so every component reads
 * one SSE stream's worth of data.
 */
export const activityFeed = new ActivityFeedStore()

export function useActivityFeed(): { runs: RunRecord[]; connection: ConnectionStatus } {
  const runs = useSyncExternalStore(activityFeed.subscribe, activityFeed.getRunsSnapshot)
  const connection = useSyncExternalStore(
    activityFeed.subscribe,
    activityFeed.getConnectionSnapshot,
  )
  return { runs, connection }
}

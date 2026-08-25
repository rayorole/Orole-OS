import { useEffect } from 'react'

import {
  activityFeed,
  type RunEvent,
  type RunRecord,
} from '#/lib/activity-feed'

/**
 * Live SSE wiring for the agent activity feed.
 *
 * One shared connection app-wide (the store is a singleton; mount this hook
 * once in the root layout). On drop, reconnects with exponential backoff
 * (1s → 30s cap), re-hydrating recent history via REST before live deltas
 * resume so nothing is missed while offline.
 */

const BACKOFF_BASE_MS = 1000
const BACKOFF_CAP_MS = 30_000

export function runsApiBase(): string {
  return import.meta.env.VITE_HERMES_API_URL ?? 'https://os.orole.be'
}

interface ApiRun {
  id: string
  status?: string
  createdAt?: string
  summary?: string
}

function apiRunToRecord(r: ApiRun): RunRecord {
  const failed = r.status === 'failed' || r.status === 'error'
  const done =
    r.status === 'completed' || r.status === 'succeeded' || failed || r.status === 'finished'
  return {
    id: r.id,
    status: failed ? 'failed' : done ? 'completed' : 'running',
    startedAt: (r.createdAt && Date.parse(r.createdAt)) || Date.now(),
    endedAt: done ? (r.createdAt && Date.parse(r.createdAt)) || Date.now() : null,
    summary: r.summary ?? `Run ${r.id}`,
  }
}

/** Parse one SSE message body into a RunEvent, tolerating malformed frames. */
export function parseSseEvent(raw: string): RunEvent | null {
  try {
    const parsed = JSON.parse(raw) as RunEvent
    if (!parsed?.data?.id) return null
    return parsed
  } catch {
    return null
  }
}

async function fetchRecentRuns(limit = 50): Promise<RunRecord[]> {
  try {
    const res = await fetch(`${runsApiBase()}/v1/runs?limit=${limit}`)
    if (!res.ok) return []
    const body = (await res.json()) as { runs?: ApiRun[] } | ApiRun[]
    const runs = Array.isArray(body) ? body : (body.runs ?? [])
    return runs.map(apiRunToRecord)
  } catch {
    return []
  }
}

export function useAgentActivityStream() {
  useEffect(() => {
    let disposed = false
    let attempt = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    async function cycle() {
      if (disposed) return
      if (attempt > 0) activityFeed.setConnection('reconnecting')
      // Catch-up first: hydrate REST history, then attach the live stream so
      // deltas apply on top of what we already know.
      const history = await fetchRecentRuns()
      if (disposed) return
      activityFeed.hydrate(history)

      const source = new EventSource(`${runsApiBase()}/v1/runs/events`)
      source.onopen = () => {
        if (!disposed) {
          attempt = 0
          activityFeed.setConnection('connected')
        }
      }
      source.onmessage = (ev) => {
        if (disposed) return
        const event = parseSseEvent(ev.data)
        if (event) activityFeed.applyEvent(event)
      }
      source.onerror = () => {
        if (disposed) return
        source.close()
        activityFeed.setConnection('reconnecting')
        const delay = Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_CAP_MS)
        attempt += 1
        timer = setTimeout(cycle, delay)
      }
    }

    void cycle()

    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [])
}

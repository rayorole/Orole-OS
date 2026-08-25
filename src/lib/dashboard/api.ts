// Transport-agnostic data layer for the dashboard.
//
// ALL requests go through the same-origin session proxy (/api/gateway/*),
// which attaches the server-held Hermes gateway key (issue #32). The browser
// never sees a key and never talks cross-origin. Without an authenticated
// session every hook degrades to its empty state with a sign-in hint instead
// of erroring — see docs/design-system.md for state conventions.

import { useEffect, useRef, useState } from 'react'
import type {
  ActivityEvent,
  AgentCard,
  AnalyticsPoint,
  KanbanColumn,
  SessionSummary,
  TimeRange,
} from './types'
import type { TranscriptMessage } from './types'
import { ApiError } from '#/lib/api-client'
import { openEventStream } from '#/lib/session-client'

/**
 * Same-origin session proxy. On the server this is rewritten to
 * ${HERMES_GATEWAY_URL:-https://os.orole.be} with the Bearer key attached,
 * e.g. /api/gateway/v1/models → $GATEWAY/v1/models.
 */
const PROXY = '/api/gateway'

export class NotAuthenticatedError extends Error {
  constructor() {
    super('Not signed in — add your gateway API key in Settings.')
    this.name = 'NotAuthenticatedError'
  }
}

function classify(status: number): string | null {
  // 401 → caller should show the signed-out state, not an error.
  if (status === 401 || status === 403) throw new NotAuthenticatedError()
  // Endpoint simply doesn't exist on this gateway build → treat as empty.
  if (status === 404 || status === 501) return null
  if (!status) throw new Error('Could not reach the backend.')
  throw new Error(`Gateway request failed (HTTP ${status}).`)
}

async function getJson<T>(path: string): Promise<T | null> {
  let res: Response
  try {
    res = await fetch(`${PROXY}${path}`, { credentials: 'same-origin' })
  } catch {
    throw new Error('Could not reach the backend. Check your network.')
  }
  const verdict = classify(res.status)
  if (verdict === null) return null
  return (await res.json()) as T
}

const now = () => new Date().toISOString()

function useLiveQuery<T>(
  key: unknown[],
  fn: () => Promise<T>,
  refetchInterval: number,
) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    const run = () =>
      fn()
        .then((d) => alive && (setData(d), setError(null)))
        .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
        .finally(() => alive && setLoading(false))
    run()
    const t = setInterval(run, refetchInterval)
    return () => {
      alive = false
      clearInterval(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, key)

  return { data, error, loading }
}

export function useAgents() {
  return useLiveQuery<AgentCard[]>(
    ['agents'],
    async () => {
      // Preferred: fleet jobs from the gateway API server, mapped to cards.
      const jobs = await getJson<{ jobs?: unknown[] }>('/api/jobs')
      return jobs?.jobs ? mapJobsToAgents(jobs.jobs) : []
    },
    15_000,
  )
}

export function useSessions() {
  return useLiveQuery<SessionSummary[]>(
    ['sessions'],
    async () => {
      const data = await getJson<{ items?: SessionSummary[] }>('/api/jobs')
      return data?.items ?? []
    },
    30_000,
  )
}

export function useKanbanBoard() {
  return useLiveQuery<KanbanColumn[]>(
    ['kanban'],
    async () => {
      await getJson('/api/jobs') // session liveness — board derives from jobs too
      return []
    },
    20_000,
  )
}

export function useAnalytics(range: TimeRange) {
  return useLiveQuery<AnalyticsPoint[]>(
    ['analytics', range],
    async () => {
      const data = await getJson<{ points?: AnalyticsPoint[] }>(
        `/api/analytics?range=${range}`,
      )
      return data?.points ?? []
    },
    60_000,
  )
}

/** Map gateway job records onto agent cards (best-effort, tolerant of shapes). */
function mapJobsToAgents(jobs: unknown[]): AgentCard[] {
  const byAgent = new Map<string, AgentCard>()
  for (const raw of jobs) {
    if (typeof raw !== 'object' || raw === null) continue
    const job = raw as Record<string, unknown>
    const id = String(job.agent ?? job.agent_id ?? job.name ?? job.id ?? '')
    if (!id) continue
    const status = String(job.status ?? 'idle').toLowerCase()
    const cardStatus: AgentCard['status'] =
      status === 'running' || status === 'active'
        ? 'running'
        : status === 'queued' || status === 'pending' || status === 'planning'
          ? 'thinking'
          : status === 'failed' || status === 'error'
            ? 'offline'
            : 'idle'
    const prev = byAgent.get(id)
    byAgent.set(id, {
      id,
      name: id,
      status: prev?.status === 'running' ? 'running' : cardStatus,
      currentTask:
        typeof job.task === 'string'
          ? job.task
          : typeof job.prompt === 'string'
            ? job.prompt
            : (prev?.currentTask ?? null),
      lastActiveAt:
        typeof job.updated_at === 'string'
          ? job.updated_at
          : typeof job.created_at === 'string'
            ? job.created_at
            : now(),
    })
  }
  return [...byAgent.values()]
}

/** Historical + live transcript for one agent (extends issue #12). */
export function useTranscript(agentId: string | null) {
  const [messages, setMessages] = useState<TranscriptMessage[]>([])
  const [loading, setLoading] = useState(false)
  const attemptRef = useRef(0)

  useEffect(() => {
    setMessages([])
    if (!agentId) return
    let cancelled = false

    setLoading(true)
    getJson<{ messages?: TranscriptMessage[] }>(`/api/agents/${agentId}/transcript`)
      .then((data) => {
        if (cancelled || !data) return
        setMessages(data.messages ?? [])
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    const controller = new AbortController()
    openEventStream(
      `${PROXY}/api/agents/${agentId}/transcript/stream`,
      (data) => {
        try {
          const m = JSON.parse(data) as TranscriptMessage
          setMessages((prev) => [...prev, m])
        } catch {
          /* ignore */
        }
      },
      controller.signal,
    ).catch(() => {
      // signed out or gateway without this stream — backfill only
      attemptRef.current++
    })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [agentId])

  return { messages, loading }
}
export function useActivityFeed(max = 50) {
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [connected, setConnected] = useState(false)
  const attemptRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const controller = new AbortController()

    const connect = () => {
      openEventStream(
        `${PROXY}/api/events/stream`,
        (data) => {
          try {
            const ev = JSON.parse(data) as ActivityEvent
            setEvents((prev) => [ev, ...prev].slice(0, max))
          } catch {
            /* ignore malformed frames */
          }
        },
        controller.signal,
      )
        .then(() => {
          if (!cancelled) setConnected(false)
        })
        .catch((err: unknown) => {
          if (cancelled) return
          setConnected(false)
          if (
            err instanceof NotAuthenticatedError ||
            (err instanceof ApiError && err.status === 'no-session')
          ) {
            return // signed out — stop retrying until they sign in
          }
          const delay = Math.min(30_000, 1000 * 2 ** attemptRef.current++)
          timer = setTimeout(connect, delay)
        })
    }

    connect()
    return () => {
      cancelled = true
      controller.abort()
      if (timer) clearTimeout(timer)
    }
  }, [max])

  return { events, connected }
}

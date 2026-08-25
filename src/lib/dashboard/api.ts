// Transport-agnostic data layer for the dashboard.
//
// The Hermes gateway exposes models/capabilities/runs/sessions/events
// endpoints. When `VITE_HERMES_GATEWAY_URL` is set the hooks hit it live;
// otherwise they resolve to deterministic demo fixtures so every panel still
// exercises its loading / empty / populated states in dev.

import { useEffect, useRef, useState } from 'react'
import type {
  ActivityEvent,
  AgentCard,
  AnalyticsPoint,
  KanbanColumn,
  SessionSummary,
  TimeRange,
} from './types'

export const GATEWAY_URL: string | null =
  (import.meta.env.VITE_HERMES_GATEWAY_URL as string | undefined) ?? null

async function getJson<T>(path: string): Promise<T> {
  if (!GATEWAY_URL) throw new Error('no gateway configured')
  const res = await fetch(`${GATEWAY_URL}${path}`)
  if (!res.ok) throw new Error(`gateway ${res.status}`)
  return (await res.json()) as T
}

const now = () => new Date().toISOString()

function fixtureAgents(): AgentCard[] {
  return [
    {
      id: 'coder',
      name: 'coder',
      status: 'running',
      currentTask: 'Implement issue #17 dashboard',
      lastActiveAt: now(),
    },
    {
      id: 'planner',
      name: 'planner',
      status: 'thinking',
      currentTask: 'Decompose milestone v0.3',
      lastActiveAt: now(),
    },
    {
      id: 'researcher',
      name: 'researcher',
      status: 'idle',
      currentTask: null,
      lastActiveAt: new Date(Date.now() - 36e5).toISOString(),
    },
    {
      id: 'reviewer',
      name: 'reviewer',
      status: 'offline',
      currentTask: null,
      lastActiveAt: new Date(Date.now() - 864e5).toISOString(),
    },
  ]
}

export function useAgents() {
  return useLiveQuery<AgentCard[]>(
    ['agents'],
    async () => (GATEWAY_URL ? getJson('/api/agents') : fixtureAgents()),
    15_000,
  )
}

export function useSessions() {
  return useLiveQuery<SessionSummary[]>(
    ['sessions'],
    async () => {
      if (!GATEWAY_URL) return []
      const data = await getJson<{ items: SessionSummary[] }>('/api/sessions')
      return data.items
    },
    30_000,
  )
}

export function useKanbanBoard() {
  return useLiveQuery<KanbanColumn[]>(
    ['kanban'],
    async () => (GATEWAY_URL ? getJson('/api/kanban/board') : []),
    20_000,
  )
}

export function useAnalytics(range: TimeRange) {
  return useLiveQuery<AnalyticsPoint[]>(
    ['analytics', range],
    async () => (GATEWAY_URL ? getJson(`/api/analytics?range=${range}`) : []),
    60_000,
  )
}

/**
 * SSE-driven activity feed (extends issue #5's feed spec).
 * Falls back to an empty list without a gateway; reconnects with backoff.
 */
export function useActivityFeed(max = 50) {
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [connected, setConnected] = useState(false)
  const attemptRef = useRef(0)

  useEffect(() => {
    if (!GATEWAY_URL) return
    let es: EventSource | null = null
    let timer: ReturnType<typeof setTimeout> | null = null

    const connect = () => {
      es = new EventSource(`${GATEWAY_URL}/api/events/stream`)
      es.onopen = () => {
        setConnected(true)
        attemptRef.current = 0
      }
      es.onmessage = (msg) => {
        try {
          const ev = JSON.parse(msg.data) as ActivityEvent
          setEvents((prev) => [ev, ...prev].slice(0, max))
        } catch {
          /* ignore malformed frames */
        }
      }
      es.onerror = () => {
        setConnected(false)
        es?.close()
        const delay = Math.min(30_000, 1000 * 2 ** attemptRef.current++)
        timer = setTimeout(connect, delay)
      }
    }
    connect()
    return () => {
      es?.close()
      if (timer) clearTimeout(timer)
    }
  }, [GATEWAY_URL, max])

  return { events, connected }
}

/** Historical + live transcript for one agent (extends issue #12). */
export function useTranscript(agentId: string | null) {
  const [messages, setMessages] = useState<TranscriptMessageT[]>([])
  const [loading, setLoading] = useState(false)
  const attemptRef = useRef(0)

  useEffect(() => {
    setMessages([])
    if (!agentId || !GATEWAY_URL) return
    let es: EventSource | null = null
    let cancelled = false

    setLoading(true)
    fetch(`${GATEWAY_URL}/api/agents/${agentId}/transcript`)
      .then((r) => r.json())
      .then((data: { messages: TranscriptMessageT[] }) => {
        if (!cancelled) setMessages(data.messages ?? [])
      })
      .catch(() => {})
      .finally(() => setLoading(false))

    es = new EventSource(`${GATEWAY_URL}/api/agents/${agentId}/transcript/stream`)
    es.onmessage = (msg) => {
      try {
        const m = JSON.parse(msg.data) as TranscriptMessageT
        setMessages((prev) => [...prev, m])
      } catch {
        /* ignore */
      }
    }
    es.onerror = () => {
      // simple bounded retry
      attemptRef.current++
    }

    return () => {
      cancelled = true
      es?.close()
    }
  }, [agentId])

  return { messages, loading }
}

type TranscriptMessageT = import('./types').TranscriptMessage

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
        .catch((e) => alive && setError(String(e)))
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

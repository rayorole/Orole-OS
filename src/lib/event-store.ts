/**
 * Root SSE event store — the single live connection for the whole app.
 *
 * One EventSource-equivalent (fetch-stream) connection is mounted ABOVE the
 * router outlet in the root layout (see <RootEventStream /> in __root.tsx).
 * Every route consumes events through Zustand selectors backed by
 * useSyncExternalStore — never per-page connections.
 *
 * Events are INVALIDATION SIGNALS ONLY. The store keeps a small rolling log
 * for connection state / last-event display, but never accumulates payload
 * data that could be reconstructed server-side (e.g. cost aggregates come
 * from the polled aggregate endpoint — see lib/aggregate.ts).
 */

import { useEffect } from 'react'
import { useSyncExternalStore } from 'react'
import { getQueryClient } from '#/lib/query-provider'

export type ConnState = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'offline'

export interface AppRunEvent {
  id: number
  type: string
  runId?: string
  sessionId?: string
  agentId?: string
  receivedAt: number
  data: Record<string, unknown>
}

interface EventStoreState {
  conn: ConnState
  lastEventAt: number
  eventsReceived: number
  /** Rolling tail of recent events (capped) — signals only, not source of truth. */
  recent: AppRunEvent[]
}

const RECENT_CAP = 50

let listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

let state: EventStoreState = {
  conn: 'idle',
  lastEventAt: 0,
  eventsReceived: 0,
  recent: [],
}

function setState(patch: Partial<EventStoreState>) {
  state = { ...state, ...patch }
  emit()
}

export const eventStore = {
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  getSnapshot(): EventStoreState {
    return state
  },
  /** Server-snapshot for SSR hydration — identical to client snapshot shape. */
  getServerSnapshot(): EventStoreState {
    return state
  },
}

// ── Invalidation wiring ──────────────────────────────────────────────────────

type QueryKeyLike = readonly unknown[]

const INVALIDATIONS: Record<string, QueryKeyLike[]> = {
  'run.started': [['runs']],
  'run.completed': [['runs'], ['agents']],
  'run.failed': [['runs'], ['agents']],
  'run.cancelled': [['runs'], ['agents']],
  'tool.completed': [['runs']],
  'message.completed': [['runs']],
  'session.created': [['sessions']],
  'agent.status': [['agents']],
}

export function invalidationKeysFor(type: string): QueryKeyLike[] {
  return INVALIDATIONS[type] ?? []
}

let queryClientRef: ReturnType<typeof getQueryClient> | null = null

function handleEvent(ev: Omit<AppRunEvent, 'id' | 'receivedAt'> & { id?: number }) {
  const full: AppRunEvent = {
    id: ev.id ?? state.eventsReceived + 1,
    receivedAt: Date.now(),
    ...ev,
  }

  setState({
    conn: 'live',
    lastEventAt: full.receivedAt,
    eventsReceived: full.id,
    recent: [...state.recent.slice(-(RECENT_CAP - 1)), full],
  })

  // Events are invalidation signals only — refetch from authoritative REST
  // endpoints; never reconstruct aggregates client-side from streams.
  if (!queryClientRef) queryClientRef = getQueryClient()
  for (const key of invalidationKeysFor(full.type)) {
    void queryClientRef.invalidateQueries({ queryKey: key })
  }
}

// ── Connection lifecycle ─────────────────────────────────────────────────────

export interface StreamOptions {
  url: string
  headers?: Record<string, string>
}

export class RootEventStream {
  private abort = new AbortController()
  private stopped = false
  private attempts = 0
  private opts: StreamOptions

  constructor(opts: StreamOptions) {
    this.opts = opts
  }

  start() {
    this.stopped = false
    void this.connect()
  }

  stop() {
    this.stopped = true
    this.abort.abort()
    setState({ conn: 'idle' })
  }

  private async connect() {
    if (this.stopped) return
    setState({ conn: this.attempts === 0 ? 'connecting' : 'reconnecting' })
    try {
      const res = await fetch(this.opts.url, {
        headers: { Accept: 'text/event-stream', ...this.opts.headers },
        signal: this.abort.signal,
      })
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
      this.attempts = 0
      setState({ conn: 'live' })

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        let idx: number
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, idx)
          buf = buf.slice(idx + 2)
          const parsed = parseSseFrame(frame)
          if (parsed) {
            handleEvent({
              type: parsed.event,
              data: parsed.data as Record<string, unknown>,
              runId:
                typeof (parsed.data as Record<string, unknown>).run_id === 'string'
                  ? ((parsed.data as Record<string, unknown>).run_id as string)
                  : typeof (parsed.data as Record<string, unknown>).runId === 'string'
                    ? ((parsed.data as Record<string, unknown>).runId as string)
                    : undefined,
            })
          }
        }
      }
      // Server closed the stream — treat like a drop and retry.
      throw new Error('stream ended')
    } catch (err) {
      if (this.stopped || (err instanceof DOMException && err.name === 'AbortError')) return
      this.attempts += 1
      const delay = Math.min(15000, 1000 * 2 ** Math.min(this.attempts, 4))
      setState({ conn: delay >= 8000 ? 'offline' : 'reconnecting' })
      setTimeout(() => void this.connect(), delay)
    }
  }
}

export function parseSseFrame(frame: string): { event: string; data: unknown } | null {
  let event = 'message'
  const dataLines: string[] = []
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
  }
  if (!dataLines.length && event === 'message') return null
  const raw = dataLines.join('\n')
  try {
    return { event, data: JSON.parse(raw) }
  } catch {
    return { event, data: { text: raw } }
  }
}

// ── Selector hooks ───────────────────────────────────────────────────────────

export function useConnState(): ConnState {
  return useSyncExternalStore(
    eventStore.subscribe,
    () => eventStore.getSnapshot().conn,
    () => eventStore.getServerSnapshot().conn,
  )
}

export function useRecentEvents(): AppRunEvent[] {
  return useSyncExternalStore(
    eventStore.subscribe,
    () => eventStore.getSnapshot().recent,
    () => eventStore.getServerSnapshot().recent,
  )
}

// ── Root-mounted singleton component ────────────────────────────────────────

const HERMES_BASE_URL = (import.meta.env.VITE_HERMES_BASE_URL ?? '').replace(/\/$/, '')
const HERMES_API_KEY = import.meta.env.VITE_HERMES_API_KEY ?? ''

let streamInstance: RootEventStream | null = null

/** Mount ONCE above the router outlet. Guarantees a single SSE connection. */
export function RootEventStreamMount() {
  useEffect(() => {
    if (!streamInstance) {
      streamInstance = new RootEventStream({
        url: `${HERMES_BASE_URL}/v1/events`,
        headers: HERMES_API_KEY ? { Authorization: `Bearer ${HERMES_API_KEY}` } : undefined,
      })
      streamInstance.start()
    }
    return () => {
      streamInstance?.stop()
      streamInstance = null
    }
  }, [])
  return null
}

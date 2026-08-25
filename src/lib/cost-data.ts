/**
 * Cost-view data layer (#29).
 *
 * Fetches sessions/runs from the Hermes API, derives per-agent & per-day
 * dollar costs via the SHARED pricing module `#/lib/cost` (also consumed by
 * the analytics dashboard #13 — no duplicated math), and exposes a live SSE
 * ticker hook with stale-state handling matching the status bar (#25).
 */

import { useEffect, useMemo, useRef, useState } from 'react'

import { computeCost, type Usage } from '#/lib/cost'

export const HERMES_BASE_URL = ((import.meta.env.VITE_HERMES_BASE_URL as string) ?? '').replace(/\/$/, '')
const HERMES_API_KEY = (import.meta.env.VITE_HERMES_API_KEY as string) ?? ''

function url(path: string): string {
  return `${HERMES_BASE_URL}${path}`
}

function headers(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/json', ...extra }
  if (HERMES_API_KEY) h.Authorization = `Bearer ${HERMES_API_KEY}`
  return h
}

/* ── Raw API shapes (tolerant) ─────────────────────────────────────────── */

export interface UsageRecord {
  agent: string
  model?: string | null
  /** epoch ms of the usage event */
  ts: number
  usage: Usage
}

export interface HermesSessionRow {
  id?: string
  agent?: string
  agent_id?: string
  model?: string
  created_at?: string
  updated_at?: string
  messages?: Array<{
    created_at?: string
    timestamp?: string
    model?: string
    usage?: {
      input_tokens?: number
      output_tokens?: number
      total_tokens?: number
    }
    [k: string]: unknown
  }>
}

export function agentName(s: HermesSessionRow): string {
  return s.agent ?? s.agent_id ?? 'unknown'
}

/** Flatten sessions → flat usage records (one per message carrying usage). */
export function sessionsToUsageRows(sessions: HermesSessionRow[]): UsageRecord[] {
  const rows: UsageRecord[] = []
  for (const s of sessions ?? []) {
    const agent = agentName(s)
    let any = false
    for (const m of s.messages ?? []) {
      const u = m.usage
      if (!u || (!u.input_tokens && !u.output_tokens && !u.total_tokens)) continue
      const t = m.created_at ?? m.timestamp ?? s.updated_at ?? s.created_at
      const n = t ? Date.parse(t) : NaN
      rows.push({
        agent,
        model: m.model ?? s.model ?? null,
        ts: Number.isNaN(n) ? Date.now() : n,
        usage: {
          inputTokens: u.input_tokens ?? 0,
          outputTokens:
            u.output_tokens ??
            (u.total_tokens != null ? Math.max(0, u.total_tokens - (u.input_tokens ?? 0)) : 0),
        },
      })
      any = true
    }
    if (!any) rows.push({ agent, model: null, ts: Date.now(), usage: {} })
  }
  return rows
}

export async function fetchUsage(): Promise<UsageRecord[]> {
  const res = await fetch(url('/api/sessions'), { headers: headers() })
  if (!res.ok) throw new Error(`sessions fetch failed: HTTP ${res.status}`)
  const data: unknown = await res.json()
  const list: HermesSessionRow[] = Array.isArray(data)
    ? (data as HermesSessionRow[])
    : (((data as Record<string, unknown>).sessions as HermesSessionRow[]) ?? [])
  return sessionsToUsageRows(list)
}

/* ── Derived aggregates ────────────────────────────────────────────────── */

export interface AgentCost {
  agent: string
  inputTokens: number
  outputTokens: number
  cost: number
  estimated: boolean
  lastActivity: number
}

function withinWindow(ts: number, windowMs: number, now: number): boolean {
  return now - ts <= windowMs
}

export const DAY_MS = 24 * 60 * 60 * 1000

export interface CostSummary {
  agents: AgentCost[]
  totalCost: number
  totalEstimated: boolean
  /** Daily totals across the selected window, oldest first (burn-down). */
  daily: { day: string; cost: number }[]
  todayTotal: number
}

export function summarize(rows: UsageRecord[], windowMs: number, now = Date.now()): CostSummary {
  const byAgent = new Map<string, AgentCost>()
  // day buckets keyed by local YYYY-MM-DD
  const byDay = new Map<string, number>()
  const dayCount = Math.max(1, Math.ceil(windowMs / DAY_MS))
  for (let i = dayCount - 1; i >= 0; i--) {
    const d = new Date(now - i * DAY_MS)
    byDay.set(d.toISOString().slice(0, 10), 0)
  }

  let totalCost = 0
  let totalEstimated = false

  for (const r of rows) {
    if (!withinWindow(r.ts, windowMs, now)) continue
    const { cost, estimated } = computeCost(r.usage, r.model)
    totalEstimated ||= estimated

    let a = byAgent.get(r.agent)
    if (!a)
      a = { agent: r.agent, inputTokens: 0, outputTokens: 0, cost: 0, estimated: false, lastActivity: 0 }
    a.inputTokens += r.usage.inputTokens ?? 0
    a.outputTokens += r.usage.outputTokens ?? 0
    a.cost += cost
    a.estimated ||= estimated
    a.lastActivity = Math.max(a.lastActivity, r.ts)
    byAgent.set(r.agent, a)

    totalCost += cost
    const key = new Date(r.ts).toISOString().slice(0, 10)
    if (byDay.has(key)) byDay.set(key, (byDay.get(key) ?? 0) + cost)
  }

  const daily = [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([day, cost]) => ({ day, cost }))
  const todayKey = new Date(now).toISOString().slice(0, 10)

  return {
    agents: [...byAgent.values()].sort((a, b) => b.cost - a.cost),
    totalCost,
    totalEstimated,
    daily,
    todayTotal: byDay.get(todayKey) ?? 0,
  }
}

/* ── Budget constant (TODO: replace with real provider credit balance) ─── */

/**
 * TODO(#29): no provider billing API is wired up yet — render the credits
 * gauge against this configurable budget until a real balance source exists.
 * Overridable at build time via VITE_MONTHLY_BUDGET_USD.
 */
export const MONTHLY_BUDGET_USD =
  Number((import.meta.env.VITE_MONTHLY_BUDGET_USD as string | undefined) ?? '') || 250

/* ── Live SSE hook ─────────────────────────────────────────────────────── */

export type ConnState = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'stale'

const STALE_AFTER_MS = 30_000
const REFRESH_MS = 120_000

/**
 * Live cost feed: initial REST fetch + periodic refresh + SSE run-event tail
 * that triggers an immediate refetch on activity. Marks the connection
 * `stale` when no event/fetch has landed within STALE_AFTER_MS (#25 style).
 */
export function useLiveUsage(windowMs: number): {
  summary: CostSummary | null
  conn: ConnState
  error: string | null
} {
  const [rows, setRows] = useState<UsageRecord[]>([])
  const [conn, setConn] = useState<ConnState>('connecting')
  const [error, setError] = useState<string | null>(null)
  const lastBeatRef = useRef(Date.now())

  const refresh = useMemo(
    () =>
      async function refresh() {
        try {
          const next = await fetchUsage()
          setRows(next)
          lastBeatRef.current = Date.now()
          setError(null)
          return true
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
          return false
        }
      },
    [],
  )

  // Initial load + periodic polling fallback.
  useEffect(() => {
    void refresh()
    const id = setInterval(() => void refresh(), REFRESH_MS)
    return () => clearInterval(id)
  }, [refresh])

  // SSE tail: any run event means fresh spend data may exist.
  useEffect(() => {
    let stopped = false
    let attempts = 0
    const abort = new AbortController()

    async function connect() {
      if (stopped) return
      try {
        const res = await fetch(url('/v1/runs/events'), {
          headers: headers({ Accept: 'text/event-stream' }),
          signal: abort.signal,
        })
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
        attempts = 0
        lastBeatRef.current = Date.now()

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) throw new Error('stream ended')
          buf += decoder.decode(value, { stream: true })
          let idx: number
          while ((idx = buf.indexOf('\n\n')) !== -1) {
            buf = buf.slice(idx + 2)
            lastBeatRef.current = Date.now()
            void refresh()
          }
        }
      } catch (err) {
        if (stopped || (err instanceof DOMException && err.name === 'AbortError')) return
        attempts += 1
        setTimeout(() => void connect(), Math.min(15000, 1000 * 2 ** Math.min(attempts, 4)))
      }
    }
    void connect()

    // Staleness watchdog.
    const staleId = setInterval(() => {
      if (Date.now() - lastBeatRef.current > STALE_AFTER_MS) setConn('stale')
      else setConn((c) => (c === 'stale' ? 'live' : c))
    }, 5_000)

    return () => {
      stopped = true
      abort.abort()
      clearInterval(staleId)
    }
  }, [refresh])

  const summary = useMemo(() => summarize(rows, windowMs), [rows, windowMs])

  return { summary, conn, error }
}

/**
 * Analytics data layer for the Orole-OS dashboard.
 *
 * Fetches raw sessions / messages / run events from the Hermes API server
 * and derives all chart metrics client-side (no aggregate endpoint assumed).
 * Docs: https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server
 */

export type TimeRange = '24h' | '7d' | '30d'

export const TIME_RANGES: { value: TimeRange; label: string; ms: number }[] = [
  { value: '24h', label: '24H', ms: 24 * 60 * 60 * 1000 },
  { value: '7d', label: '7D', ms: 7 * 24 * 60 * 60 * 1000 },
  { value: '30d', label: '30D', ms: 30 * 24 * 60 * 60 * 1000 },
]

/* ── Raw API shapes (tolerant: fields may be missing) ──────────────────── */

export interface HermesSession {
  id?: string
  agent?: string
  agent_id?: string
  created_at?: string
  updated_at?: string
  messages?: HermesMessage[]
}

export interface HermesMessage {
  role?: string
  created_at?: string
  timestamp?: string
  usage?: {
    input_tokens?: number
    output_tokens?: number
    total_tokens?: number
  }
}

export interface HermesRun {
  id?: string
  agent?: string
  agent_id?: string
  status?: string
  started_at?: string
  ended_at?: string
  duration_ms?: number
  error?: string
}

export interface AnalyticsData {
  sessions: HermesSession[]
  runs: HermesRun[]
  fetchedAt: string
}

const DEFAULT_BASE = '/api/hermes'

function apiBase(): string {
  // Allow overriding at build time; falls back to the app's own proxy route.
  return (
    (typeof import.meta !== 'undefined' &&
      (import.meta.env?.VITE_HERMES_API_URL as string | undefined)) ||
    DEFAULT_BASE
  )
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`Hermes API ${res.status}: ${path}`)
  return res.json() as Promise<T>
}

function list<T>(payload: unknown, key?: string): T[] {
  if (Array.isArray(payload)) return payload as T[]
  if (payload && typeof payload === 'object') {
    if (key && Array.isArray((payload as Record<string, unknown>)[key]))
      return (payload as Record<string, unknown>)[key] as T[]
    // common wrappers
    for (const k of ['data', 'items', 'sessions', 'runs', 'results']) {
      if (Array.isArray((payload as Record<string, unknown>)[k]))
        return (payload as Record<string, unknown>)[k] as T[]
    }
  }
  return []
}

/** Fetch everything needed for analytics; tolerates partial availability. */
export async function fetchAnalyticsData(): Promise<AnalyticsData> {
  const [sessionsRes, runsRes] = await Promise.allSettled([
    fetchJson<unknown>('/sessions'),
    fetchJson<unknown>('/runs'),
  ])

  const sessions = list<HermesSession>(
    sessionsRes.status === 'fulfilled' ? sessionsRes.value : [],
    'sessions',
  )
  const runs = list<HermesRun>(
    runsRes.status === 'fulfilled' ? runsRes.value : [],
    'runs',
  )

  return { sessions, runs, fetchedAt: new Date().toISOString() }
}

/* ── Derived metrics ───────────────────────────────────────────────────── */

const NEON_COLORS = [
  '#5eead4', // neon cyan
  '#a78bfa', // neon violet
  '#fbbf24', // amber
  '#f472b6',
  '#38bdf8',
  '#34d399',
]

export function colorFor(index: number): string {
  return NEON_COLORS[index % NEON_COLORS.length]
}

export function agentOf(session: HermesSession, run?: HermesRun): string {
  return session.agent ?? session.agent_id ?? run?.agent ?? run?.agent_id ?? 'unknown'
}

function msgTime(m: HermesMessage, s: HermesSession): number | null {
  const t = m.created_at ?? m.timestamp ?? s.updated_at ?? s.created_at
  const n = t ? Date.parse(t) : NaN
  return Number.isNaN(n) ? null : n
}

function sessionTime(s: HermesSession): number | null {
  const t = s.updated_at ?? s.created_at
  const n = t ? Date.parse(t) : NaN
  return Number.isNaN(n) ? null : n
}

export function withinRange(ts: number | null, rangeMs: number, now: number): boolean {
  if (ts === null) return true // keep undated entries rather than silently dropping
  return now - ts <= rangeMs
}

/** Cost per 1M tokens (rough blended rate; tune per model when known). */
const COST_PER_MTOK = 3.0

export interface ActivityPoint {
  bucket: string
  [agent: string]: string | number
}

/** Messages/events per agent over time, bucketed into ~12 buckets across the window. */
export function deriveActivity(
  data: AnalyticsData,
  rangeMs: number,
): { points: ActivityPoint[]; agents: string[] } {
  const now = Date.now()
  const start = now - rangeMs
  const buckets = 12
  const step = rangeMs / buckets

  const agentsSet = new Set<string>()
  const series = new Map<string, number[]>() // agent -> counts per bucket

  const bump = (agent: string, ts: number | null) => {
    if (ts === null || ts < start || ts > now) return
    agentsSet.add(agent)
    if (!series.has(agent)) series.set(agent, new Array(buckets).fill(0))
    const idx = Math.min(buckets - 1, Math.floor((ts - start) / step))
    series.get(agent)![idx]++
  }

  for (const s of data.sessions) {
    const agent = agentOf(s)
    if (s.messages?.length) {
      for (const m of s.messages) bump(agent, msgTime(m, s))
    } else {
      bump(agent, sessionTime(s))
    }
  }

  const fmt = (t: number) => {
    const d = new Date(t)
    return rangeMs <= TIME_RANGES[0].ms
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }

  const points: ActivityPoint[] = []
  for (let i = 0; i < buckets; i++) {
    const point: ActivityPoint = { bucket: fmt(start + i * step + step / 2) }
    for (const [agent, counts] of series) point[agent] = counts[i]
    points.push(point)
  }
  return { points, agents: [...agentsSet].sort() }
}

export interface AgentUsage {
  agent: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cost: number
}

/** Tokens & estimated cost per agent. */
export function deriveTokenCost(data: AnalyticsData, rangeMs: number): AgentUsage[] {
  const now = Date.now()
  const byAgent = new Map<string, AgentUsage>()

  const add = (agent: string, input: number, output: number) => {
    let u = byAgent.get(agent)
    if (!u) {
      u = { agent, inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0 }
      byAgent.set(agent, u)
    }
    u.inputTokens += input
    u.outputTokens += output
    u.totalTokens += input + output
  }

  for (const s of data.sessions) {
    const ts = sessionTime(s)
    if (!withinRange(ts, rangeMs, now)) continue
    const agent = agentOf(s)
    let any = false
    for (const m of s.messages ?? []) {
      const mt = msgTime(m, s)
      if (!withinRange(mt, rangeMs, now)) continue
      const input = m.usage?.input_tokens ?? 0
      const output =
        m.usage?.output_tokens ??
        (m.usage?.total_tokens != null
          ? Math.max(0, m.usage.total_tokens - input)
          : 0)
      if (input || output) {
        add(agent, input, output)
        any = true
      }
    }
    if (!any && !s.messages?.length) {
      // Session without message-level usage: count nothing but keep the agent visible
      add(agent, 0, 0)
    }
  }

  const out = [...byAgent.values()]
  for (const u of out) u.cost = (u.totalTokens / 1_000_000) * COST_PER_MTOK
  return out.sort((a, b) => b.totalTokens - a.totalTokens)
}

export interface UsageCount {
  name: string
  count: number
}

/**
 * Skill invocations & MCP tool calls, extracted from assistant message text
 * (tool-call markers like `skill_view(name=...)` / `mcp__server__tool`).
 */
export function deriveToolUsage(
  data: AnalyticsData,
  rangeMs: number,
): { skills: UsageCount[]; mcpTools: UsageCount[] } {
  const now = Date.now()
  const skills = new Map<string, number>()
  const mcp = new Map<string, number>()

  const scan = (text: string) => {
    // skill_manage(action='create'), skill_view(name='...'), etc.
    const skillRe = /skill_(?:view|manage|list)\s*\(/gi
    while (skillRe.exec(text)) {
      const nameMatch =
        /name\s*=\s*['"]([\w:-]+)['"]/i.exec(text.slice(skillRe.lastIndex, skillRe.lastIndex + 120)) ?? null
      const name = nameMatch ? nameMatch[1] : 'unspecified'
      skills.set(name, (skills.get(name) ?? 0) + 1)
    }
    // MCP tool naming: mcp__<server>__<tool>
    const mcpRe = /\bmcp__([\w.-]+)__([\w.-]+)/g
    let mm: RegExpExecArray | null
    while ((mm = mcpRe.exec(text))) {
      const name = `${mm[1]}:${mm[2]}`
      mcp.set(name, (mcp.get(name) ?? 0) + 1)
    }
  }

  for (const s of data.sessions) {
    for (const m of s.messages ?? []) {
      const mt = msgTime(m, s)
      if (!withinRange(mt, rangeMs, now)) continue
      const text =
        typeof (m as unknown as { content?: unknown }).content === 'string'
          ? ((m as unknown as { content: string }).content as string)
          : ''
      if (text) scan(text)
    }
  }

  const toSorted = (map: Map<string, number>, topN = 8): UsageCount[] =>
    [...map.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, topN)

  return { skills: toSorted(skills), mcpTools: toSorted(mcp) }
}

export interface DurationBucket extends UsageCount {}

/** Run duration distribution (seconds buckets) plus success/fail split. */
export function deriveRuns(
  data: AnalyticsData,
  rangeMs: number,
): { durations: DurationBucket[]; success: number; failed: number } {
  const now = Date.now()
  const BUCKETS = ['<10s', '10–30s', '30–60s', '1–5m', '>5m']
  const durations = BUCKETS.map((name) => ({ name, count: 0 }))
  let success = 0
  let failed = 0

  for (const r of data.runs) {
    const st = r.started_at ? Date.parse(r.started_at) : NaN
    if (!withinRange(Number.isNaN(st) ? null : st, rangeMs, now)) continue

    const okStatus = /^(completed|success|succeeded|finished|done)$/i.test(r.status ?? '')
    const badStatus = /^(failed|error|errored|stopped|cancelled|canceled|timeout)$/i.test(r.status ?? '')
    if (badStatus || r.error) failed++
    else if (okStatus || r.status == null) success++

    let secs: number | null = null
    if (r.duration_ms != null) secs = r.duration_ms / 1000
    else if (!Number.isNaN(st) && r.ended_at) {
      const en = Date.parse(r.ended_at)
      if (!Number.isNaN(en)) secs = (en - st) / 1000
    }
    if (secs != null) {
      const idx =
        secs < 10 ? 0 : secs < 30 ? 1 : secs < 60 ? 2 : secs < 300 ? 3 : 4
      durations[idx].count++
    }
  }
  return { durations, success, failed }
}

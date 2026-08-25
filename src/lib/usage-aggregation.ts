/**
 * Client-side aggregation of skill/tool usage for the leaderboards (#30).
 *
 * Input is the union of tool-call records found in run/session history —
 * either `tool_calls` blocks on assistant messages (historical backfill) or
 * parsed tool events from the live stream. There is no server-side aggregate
 * endpoint, so all grouping / bucketing / delta math happens here.
 */

/** One normalized tool call. */
export interface ToolCall {
  /** Tool or skill name, e.g. "terminal", "mcp__github__list_issues". */
  name: string
 /** ISO-8601 timestamp of the call. */
  ts: string
}

export type TimeWindow = '7d' | '30d'

export const WINDOW_DAYS: Record<TimeWindow, number> = { '7d': 7, '30d': 30 }

/* ── MCP server extraction ─────────────────────────────────────────────── */

/**
 * Extract the MCP server from a Hermes tool name.
 * Convention: `mcp__<server>__<tool>` → `<server>`. Everything else
 * (built-in tools, skills) is not an MCP call and returns null.
 */
export function mcpServerOf(toolName: string): string | null {
  const m = /^mcp__([^_]+)__/.exec(toolName)
  return m ? m[1] : null
}

/* ── Windowing & bucketing ─────────────────────────────────────────────── */

function startOfDay(d: Date): Date {
  const c = new Date(d)
  c.setHours(0, 0, 0, 0)
  return c
}

/**
 * Inclusive window bounds: [start, endExclusive). The window ends at the end
 * of "today" and spans `days` calendar days back.
 */
export function windowBounds(now: Date, days: number): { start: Date; end: Date } {
  const end = new Date(startOfDay(now).getTime() + 24 * 3600_000)
  const start = new Date(end.getTime() - days * 24 * 3600_000)
  return { start, end }
}

function inWindow(ts: string, start: Date, end: Date): boolean {
  const t = new Date(ts).getTime()
  if (Number.isNaN(t)) return false
  return t >= start.getTime() && t < end.getTime()
}

/** Per-day call counts across the window; index 0 = oldest day. Length = days. */
export function bucketByDay(calls: ToolCall[], now: Date, days: number): number[] {
  const { start } = windowBounds(now, days)
  const buckets = new Array<number>(days).fill(0)
  for (const c of calls) {
    const t = new Date(c.ts).getTime()
    if (Number.isNaN(t) || t < start.getTime()) continue
    const idx = Math.floor((t - start.getTime()) / (24 * 3600_000))
    if (idx >= 0 && idx < days) buckets[idx] += 1
  }
  return buckets
}

/* ── Leaderboard rows ──────────────────────────────────────────────────── */

export interface LeaderboardRow {
  rank: number
  name: string
  count: number
  /** Per-day counts over the current window (sparkline data). */
  daily: number[]
  /** Percentage change vs the equivalent prior window; null when prior was 0. */
  deltaPct: number | null
  /** True when this row aggregates everything below the top-N cutoff. */
  isOthers?: boolean
}

export const TOP_N = 10

/**
 * Build the skills/tools leaderboard:
 *  - filter calls to the current window,
 *  - group by tool name, rank by count desc (name asc tiebreak),
 *  - top TOP_N kept individually; remaining distinct tools collapse into a
 *    synthetic "others" row (documented cutoff handling for 50+ tools),
 *  - each row carries its per-day distribution and Δ% vs the prior window.
 */
export function buildLeaderboard(
  calls: ToolCall[],
  now: Date,
  window: TimeWindow,
  topN: number = TOP_N,
): LeaderboardRow[] {
  const days = WINDOW_DAYS[window]
  const cur = windowBounds(now, days)
  const prevStart = new Date(cur.start.getTime() - days * 24 * 3600_000)

  const counts = new Map<string, number>()
  const prevCounts = new Map<string, number>()

  for (const c of calls) {
    if (!c.name) continue
    if (inWindow(c.ts, cur.start, cur.end)) {
      counts.set(c.name, (counts.get(c.name) ?? 0) + 1)
    } else if (inWindow(c.ts, prevStart, cur.start)) {
      prevCounts.set(c.name, (prevCounts.get(c.name) ?? 0) + 1)
    }
  }

  const ranked = [...counts.entries()].sort(
    ([an, ac], [bn, bc]) => bc - ac || an.localeCompare(bn),
  )

  const head = ranked.slice(0, topN)
  const tail = ranked.slice(topN)

  const rows: LeaderboardRow[] = head.map(([name, count], i) => ({
    rank: i + 1,
    name,
    count,
    daily: bucketByDay(
      calls.filter((c) => c.name === name),
      now,
      days,
    ),
    deltaPct: pct(count, prevCounts.get(name) ?? 0),
  }))

  if (tail.length) {
    const othersCount = tail.reduce((s, [, n]) => s + (n as number), 0)
    let prevOthers = 0
    for (const [n] of tail) prevOthers += prevCounts.get(n) ?? 0
    const names = new Set(tail.map(([n]) => n))
    rows.push({
      rank: topN + 1,
      name: `others (${tail.length})`,
      count: othersCount,
      daily: bucketByDay(
        calls.filter((c) => names.has(c.name)),
        now,
        days,
      ),
      deltaPct: pct(othersCount, prevOthers),
      isOthers: true,
    })
  }

  return rows
}

function pct(current: number, prior: number): number | null {
  if (prior === 0) return null
  return ((current - prior) / prior) * 100
}

/* ── MCP donut data ────────────────────────────────────────────────────── */

export interface McpSlice {
  server: string
  count: number
  sharePct: number
}

/**
 * Group MCP calls (`mcp__server__tool` naming) by server within the window,
 * largest first. Non-MCP calls are ignored — donut totals reconcile with the
 * leaderboard only on the subset of MCP-named tools.
 */
export function buildMcpDonut(
  calls: ToolCall[],
  now: Date,
  window: TimeWindow,
): { slices: McpSlice[]; total: number } {
  const days = WINDOW_DAYS[window]
  const { start, end } = windowBounds(now, days)

  const counts = new Map<string, number>()
  let total = 0
  for (const c of calls) {
    if (!inWindow(c.ts, start, end)) continue
    const server = mcpServerOf(c.name)
    if (!server) continue
    counts.set(server, (counts.get(server) ?? 0) + 1)
    total += 1
  }

  const slices = [...counts.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([server, count]) => ({
      server,
      count,
      sharePct: total ? (count / total) * 100 : 0,
    }))

  return { slices, total }
}

import { describe, expect, it } from 'vitest'
import {
  bucketByDay,
  buildLeaderboard,
  buildMcpDonut,
  mcpServerOf,
  windowBounds,
  type ToolCall,
} from '#/lib/usage-aggregation'

// Fixed "now" so all window math is deterministic.
const NOW = new Date('2026-08-25T12:00:00Z')
const DAY = 24 * 3600_000

function call(name: string, daysAgo: number, hour = 10): ToolCall {
  const d = new Date(NOW.getTime() - daysAgo * DAY)
  d.setUTCHours(hour, 0, 0, 0)
  return { name, ts: d.toISOString() }
}

describe('mcpServerOf', () => {
  it('extracts the server from mcp__server__tool names', () => {
    expect(mcpServerOf('mcp__github__list_issues')).toBe('github')
  })

  it('returns null for non-MCP tool names', () => {
    expect(mcpServerOf('terminal')).toBeNull()
    expect(mcpServerOf('read_file')).toBeNull()
  })
})

describe('windowBounds', () => {
  it('spans exactly `days` calendar days ending at end of today', () => {
    const { start, end } = windowBounds(NOW, 7)
    expect(end.getTime() - start.getTime()).toBe(7 * DAY)
    // End is midnight after today (exclusive).
    expect(end.getUTCHours()).toBe(0)
  })
})

describe('bucketByDay', () => {
  it('returns one bucket per day, oldest first', () => {
    const calls = [call('a', 6), call('a', 1), call('a', 1), call('a', 0)]
    expect(bucketByDay(calls, NOW, 7)).toEqual([1, 0, 0, 0, 0, 2, 1])
  })

  it('ignores calls outside the window and malformed timestamps', () => {
    const calls = [call('a', 8), { name: 'b', ts: 'not-a-date' }]
    expect(bucketByDay(calls, NOW, 7)).toEqual([0, 0, 0, 0, 0, 0, 0])
  })

  it('supports the 30-day window', () => {
    const buckets = bucketByDay([call('a', 29), call('a', 20)], NOW, 30)
    expect(buckets).toHaveLength(30)
    expect(buckets[0]).toBe(1)
    expect(buckets[9]).toBe(1)
  })
})

describe('buildLeaderboard', () => {
  it('ranks tools by count desc with name tiebreak', () => {
    const calls = [
      ...Array.from({ length: 5 }, (_, i) => call('terminal', i % 7)),
      ...Array.from({ length: 3 }, (_, i) => call('read_file', i)),
      ...Array.from({ length: 5 }, (_, i) => call('write_file', (i + 2) % 7)),
      call('patch', 0),
    ]
    const rows = buildLeaderboard(calls, NOW, '7d', 10)
    expect(rows.map((r) => r.name)).toEqual(['terminal', 'write_file', 'read_file', 'patch'])
    expect(rows.map((r) => r.count)).toEqual([5, 5, 3, 1])
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4])
  })

  it('computes delta vs prior week: up, down, and null for new tools', () => {
    // terminal: 5 this week vs 4 last week → +25%
    const calls: ToolCall[] = Array.from({ length: 5 }, (_, i) =>
      call('terminal', i % 7),
    )
    // last week's four terminal calls (days 7-13 ago)
    calls.push(...Array.from({ length: 4 }, (_, i) => call('terminal', 7 + i)))
    // read_file: 1 this week, 3 last week → -66.67%
    calls.push(call('read_file', 0))
    calls.push(call('read_file', 9), call('read_file', 10), call('read_file', 11))
    // patch: only this week → null
    calls.push(call('patch', 0))

    const byName = new Map(
      buildLeaderboard(calls, NOW, '7d').map((r) => [r.name, r.deltaPct]),
    )
    expect(byName.get('terminal')).toBeCloseTo(25)
    expect(byName.get('read_file')).toBeCloseTo(-66.666, 2)
    expect(byName.get('patch')).toBeNull()
  })

  it('collapses tail into an "others" row past the top-N cutoff', () => {
    const calls: ToolCall[] = []
    // 12 distinct tools, each called once; plus a heavy top tool
    for (let t = 0; t < 12; t++) calls.push(call(`tool_${String(t).padStart(2, '0')}`, 0))
    calls.push(...Array.from({ length: 20 }, () => call('heavy', 0)))

    const rows = buildLeaderboard(calls, NOW, '7d', 10)
    expect(rows).toHaveLength(11)
    expect(rows[0].name).toBe('heavy')
    const others = rows[rows.length - 1]
    expect(others.isOthers).toBe(true)
    expect(others.name).toBe('others (3)')
    expect(others.count).toBe(3)
    expect(others.daily.reduce((a, b) => a + b, 0)).toBe(3)
  })

  it('sparkline daily arrays sum to the row count', () => {
    const calls = [
      call('a', 0),
      call('a', 2),
      call('a', 6),
      call('a', 9), // outside window — must not inflate count
    ]
    const rows = buildLeaderboard(calls, NOW, '7d')
    expect(rows).toHaveLength(1)
    expect(rows[0].count).toBe(3)
    expect(rows[0].daily.reduce((x, y) => x + y, 0)).toBe(3)
  })

  it('returns empty for no in-window calls', () => {
    expect(buildLeaderboard([], NOW, '7d')).toEqual([])
    expect(buildLeaderboard([call('old', 60)], NOW, '30d')).toEqual([])
  })

  it('handles the 30-day window including prior-window deltas', () => {
    const calls = [
      ...Array.from({ length: 10 }, (_, i) => call('a', i)), // current 30d
      ...Array.from({ length: 5 }, (_, i) => call('a', 30 + i)), // prior 30d
    ]
    const rows = buildLeaderboard(calls, NOW, '30d')
    expect(rows[0].count).toBe(10)
    expect(rows[0].deltaPct).toBeCloseTo(100)
  })
})

describe('buildMcpDonut', () => {
  it('groups mcp__server__tool calls by server, largest first', () => {
    const calls = [
      call('mcp__github__list_issues', 0),
      call('mcp__github__create_pr', 1),
      call('mcp__slack__post_message', 2),
      call('mcp__github__list_issues', 3),
      call('terminal', 0), // not MCP — ignored
    ]
    const { slices, total } = buildMcpDonut(calls, NOW, '7d')
    expect(total).toBe(4)
    expect(slices.map((s) => s.server)).toEqual(['github', 'slack'])
    expect(slices[0].count).toBe(3)
    expect(slices[0].sharePct).toBeCloseTo(75)
    expect(slices[1].sharePct).toBeCloseTo(25)
  })

  it('respects the time window', () => {
    const calls = [
      call('mcp__github__list_issues', 0),
      call('mcp__slack__post_message', 20), // outside 7d
    ]
    expect(buildMcpDonut(calls, NOW, '7d')).toEqual({
      slices: [{ server: 'github', count: 1, sharePct: 100 }],
      total: 1,
    })
    const month = buildMcpDonut(calls, NOW, '30d')
    expect(month.total).toBe(2)
    expect(month.slices).toHaveLength(2)
  })

  it('returns empty slices and zero total when nothing is MCP', () => {
    expect(buildMcpDonut([call('terminal', 0)], NOW, '7d')).toEqual({
      slices: [],
      total: 0,
    })
  })
})

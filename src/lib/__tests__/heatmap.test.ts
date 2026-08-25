import { describe, expect, it } from 'vitest'

import {
  bucketRunsByDay,
  buildGrid,
  cellColor,
  classifyRun,
  dayKey,
  failurePercent,
  type DayBucket,
  type HeatmapRun,
} from '../heatmap'

describe('dayKey', () => {
  it('formats a local-time ISO date', () => {
    // 2026-08-25 15:30 local
    const ms = new Date(2026, 7, 25, 15, 30).getTime()
    expect(dayKey(ms)).toBe('2026-08-25')
  })

  it('pads month and day', () => {
    expect(dayKey(new Date(2026, 0, 3).getTime())).toBe('2026-01-03')
  })

  it('does not shift across UTC day boundaries (late-evening run)', () => {
    // 23:59 local must stay on the same local date even if UTC is next day.
    const d = new Date(2026, 4, 10, 23, 59)
    expect(dayKey(d.getTime())).toBe('2026-05-10')
  })
})

describe('classifyRun', () => {
  it('maps known statuses', () => {
    expect(classifyRun('completed')).toBe('success')
    expect(classifyRun('succeeded')).toBe('success')
    expect(classifyRun('failed')).toBe('failure')
    expect(classifyRun('error')).toBe('failure')
    expect(classifyRun('running')).toBe('other')
    expect(classifyRun(undefined)).toBe('other')
  })

  it('is case-insensitive', () => {
    expect(classifyRun('COMPLETED')).toBe('success')
    expect(classifyRun('Failed')).toBe('failure')
  })
})

describe('bucketRunsByDay', () => {
  it('buckets runs into local days with correct counts', () => {
    const runs: HeatmapRun[] = [
      { endedAt: new Date(2026, 7, 20, 9).getTime(), status: 'completed' },
      { endedAt: new Date(2026, 7, 20, 18).getTime(), status: 'failed' },
      { endedAt: new Date(2026, 7, 21, 8).getTime(), status: 'succeeded' },
    ]
    const map = bucketRunsByDay(runs)
    expect(map.get('2026-08-20')).toEqual({
      key: '2026-08-20',
      total: 2,
      succeeded: 1,
      failed: 1,
    })
    expect(map.get('2026-08-21')?.total).toBe(1)
  })

  it('skips runs without a valid endedAt', () => {
    const map = bucketRunsByDay([
      { endedAt: null, status: 'completed' },
      { endedAt: Number.NaN, status: 'failed' },
    ])
    expect(map.size).toBe(0)
  })

  it('tallies "other" outcomes in total but neither column', () => {
    const map = bucketRunsByDay([
      { endedAt: new Date(2026, 0, 1).getTime(), status: 'running' },
    ])
    const b = map.get('2026-01-01')!
    expect(b.total).toBe(1)
    expect(b.succeeded).toBe(0)
    expect(b.failed).toBe(0)
  })
})

describe('buildGrid', () => {
  it('produces weeks columns × 7 weekday rows starting Sunday', () => {
    const now = new Date(2026, 7, 25) // Tuesday
    const grid = buildGrid(new Map(), 13, now)
    expect(grid).toHaveLength(13)
    for (const col of grid) expect(col).toHaveLength(7)
    // First cell of the window must be a Sunday
    expect(grid[0][0].date.getDay()).toBe(0)
  })

  it('marks today and leaves future cells flagged', () => {
    const now = new Date(2026, 7, 25)
    const grid = buildGrid(new Map(), 26, now)
    const flat = grid.flat()
    const todays = flat.filter((c) => c.isToday)
    expect(todays).toHaveLength(1)
    expect(todays[0].key).toBe('2026-08-25')
    for (const c of flat.filter((c) => c.date > now)) expect(c.isFuture).toBe(true)
    for (const c of flat.filter((c) => !c.isFuture)) expect(c.isFuture).toBe(false)
  })

  it('attaches buckets to matching cells; empty days get null bucket', () => {
    const now = new Date(2026, 7, 25)
    const runs: HeatmapRun[] = [
      { endedAt: new Date(2026, 7, 24, 12).getTime(), status: 'failed' },
      { endedAt: new Date(2026, 7, 24, 13).getTime(), status: 'completed' },
    ]
    const buckets = bucketRunsByDay(runs)
    const grid = buildGrid(buckets, 13, now)
    const cell = grid.flat().find((c) => c.key === '2026-08-24')!
    expect(cell.bucket).toEqual({
      key: '2026-08-24',
      total: 2,
      succeeded: 1,
      failed: 1,
    })
    // A day with no runs inside the window still exists as a cell — with no bucket.
    const empty = grid.flat().filter((c) => c.bucket === null && !c.isFuture)
    expect(empty.length).toBeGreaterThan(0)
    expect(empty.every((c) => cellColor(c.bucket) === null)).toBe(true)
  })
})

describe('cellColor', () => {
  it('returns null for empty/absent buckets (empty day)', () => {
    expect(cellColor(null)).toBeNull()
    expect(cellColor({ key: 'x', total: 0, succeeded: 0, failed: 0 })).toBeNull()
  })

  it('is pure success green at the running-status hue anchor', () => {
    const b: DayBucket = { key: 'x', total: 5, succeeded: 5, failed: 0 }
    expect(cellColor(b)).toMatch(/oklch\([\d.]+ [\d.]+ 155\.0\)/)
  })

  it('is failure red at the failed-status hue anchor', () => {
    const b: DayBucket = { key: 'x', total: 5, succeeded: 0, failed: 5 }
    expect(cellColor(b)).toMatch(/oklch\([\d.]+ [\d.]+ 25\.0\)/)
  })

  it('interpolates hue monotonically with failure ratio', () => {
    const hues = [0, 0.25, 0.5, 0.75, 1].map((r) => {
      const b: DayBucket = {
        key: 'x',
        total: 4,
        succeeded: Math.round(4 * (1 - r)),
        failed: Math.round(4 * r),
      }
      return Number.parseFloat(cellColor(b)!.split(' ')[2])
    })
    for (let i = 1; i < hues.length; i++) expect(hues[i]).toBeLessThan(hues[i - 1])
  })

  it('increases intensity (lightness + chroma) with total volume', () => {
    const parse = (total: number) => {
      const b: DayBucket = { key: 'x', total, succeeded: total, failed: 0 }
      const m = cellColor(b)!.match(/oklch\(([\d.]+) ([\d.]+)/)!
      return { l: Number.parseFloat(m[1]), c: Number.parseFloat(m[2]) }
    }
    const one = parse(1)
    const ten = parse(10)
    const twenty = parse(20)
    expect(ten.l).toBeGreaterThan(one.l)
    expect(twenty.l).toBeGreaterThanOrEqual(ten.l)
    expect(ten.c).toBeGreaterThan(one.c)
    // Intensity saturates rather than growing unbounded
    const fifty = parse(50)
    expect(fifty.l).toBeCloseTo(parse(200).l, 5)
  })
})

describe('failurePercent', () => {
  it('rounds and handles empty days', () => {
    expect(failurePercent(null)).toBeNull()
    expect(
      failurePercent({ key: 'x', total: 3, succeeded: 2, failed: 1 }),
    ).toBe(33)
    expect(
      failurePercent({ key: 'x', total: 0, succeeded: 0, failed: 0 }),
    ).toBeNull()
  })
})

describe('tooltip reconciliation', () => {
  it('tooltip counts derived from buckets equal raw run-list tallies', () => {
    const runs: HeatmapRun[] = Array.from({ length: 17 }, (_, i) => ({
      endedAt: new Date(2026, 2, 14, i % 12, i).getTime(),
      status: i % 3 === 0 ? 'failed' : 'completed',
    }))
    const bucket = bucketRunsByDay(runs).get('2026-03-14')!
    const rawSucceeded = runs.filter((r) => classifyRun(r.status) === 'success').length
    const rawFailed = runs.filter((r) => classifyRun(r.status) === 'failure').length
    expect(bucket.total).toBe(runs.length)
    expect(bucket.succeeded).toBe(rawSucceeded)
    expect(bucket.failed).toBe(rawFailed)
    expect(failurePercent(bucket)).toBe(Math.round((rawFailed / runs.length) * 100))
  })
})

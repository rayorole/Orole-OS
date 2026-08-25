import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ActivityFeedStore,
  normalizeRunEvent,
  type RunEvent,
} from '#/lib/activity-feed'
import { parseSseEvent } from '#/lib/use-agent-activity-stream'

function started(id: string, at = 1000): RunEvent {
  return {
    event: 'run.started',
    data: { id, status: 'running', startedAt: at, summary: `task ${id}` },
  }
}

function completed(id: string, at: number, error?: string): RunEvent {
  return {
    event: 'run.completed',
    data: {
      id,
      status: error ? 'failed' : 'completed',
      endedAt: at,
      ...(error ? { error } : {}),
    },
  }
}

function freshStore(): ActivityFeedStore {
  return new ActivityFeedStore()
}

describe('activity feed store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
  })
  afterEach(() => vi.useRealTimers())

  it('orders runs newest first', () => {
    const s = freshStore()
    s.applyEvent(started('a', 1000))
    s.applyEvent(started('b', 2000))
    s.applyEvent(started('c', 3000))
    expect(s.getRunsSnapshot().map((r) => r.id)).toEqual(['c', 'b', 'a'])
  })

  it('upserts by id through a full lifecycle', () => {
    const s = freshStore()
    s.applyEvent(started('a', 1000))
    s.applyEvent({
      event: 'run.updated',
      data: { id: 'a', summary: 'halfway done' },
    })
    s.applyEvent(completed('a', 5000))

    expect(s.getRunsSnapshot()).toHaveLength(1)
    const run = s.getRunsSnapshot()[0]
    expect(run.status).toBe('completed')
    expect(run.endedAt).toBe(5000)
  })

  it('marks failed completions and keeps the error message', () => {
    const s = freshStore()
    s.applyEvent(started('x'))
    s.applyEvent(completed('x', 9000, 'boom'))
    const run = s.getRunsSnapshot()[0]
    expect(run.status).toBe('failed')
    expect(run.error).toBe('boom')
  })

  it('caps history at 100 entries', () => {
    const s = freshStore()
    for (let i = 0; i < 150; i++) s.applyEvent(started(`run-${i}`, i * 10 + 1))
    expect(s.getRunsSnapshot().length).toBe(100)
    // Newest kept.
    expect(s.getRunsSnapshot()[0].id).toBe('run-149')
  })

  it('hydrate fills gaps but live events win over stale REST snapshots', () => {
    const s = freshStore()
    // REST history fetched first.
    s.hydrate([
      { id: 'old', status: 'completed', startedAt: 1, endedAt: 2, summary: 'old' },
      { id: 'live', status: 'completed', startedAt: 3, endedAt: 4, summary: 'stale-rest' },
    ])
    // A live delta already applied must not be clobbered.
    s.applyEvent({
      event: 'run.started',
      data: { id: 'live', startedAt: 3, summary: 'live version' },
    })
    s.hydrate([
      { id: 'live', status: 'completed', startedAt: 3, endedAt: 4, summary: 'stale-rest' },
    ])
    const live = s.getRunsSnapshot().find((r) => r.id === 'live')!
    expect(live.status).toBe('running')
    expect(live.summary).toBe('live version')
    expect(s.getRunsSnapshot().some((r) => r.id === 'old')).toBe(true)
  })

  it('notifies subscribers on changes', () => {
    const s = freshStore()
    let calls = 0
    const unsub = s.subscribe(() => calls++)
    s.applyEvent(started('a'))
    s.applyEvent(completed('a', 5))
    unsub()
    s.applyEvent(started('b'))
    expect(calls).toBe(2)
  })

  it('tracks connection status transitions', () => {
    const s = freshStore()
    expect(s.getConnectionSnapshot()).toBe('offline')
    s.setConnection('connected')
    s.setConnection('reconnecting')
    s.setConnection('reconnecting') // no duplicate emit
    expect(s.getConnectionSnapshot()).toBe('reconnecting')
  })
})

describe('normalizeRunEvent', () => {
  it('normalizes ISO timestamps to local epoch ms', () => {
    const rec = normalizeRunEvent({
      event: 'run.completed',
      data: { id: 'a', startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-01-01T00:01:00Z' },
    })
    expect(rec.startedAt).toBe(Date.parse('2026-01-01T00:00:00Z'))
    expect(rec.endedAt).toBe(Date.parse('2026-01-01T00:01:00Z'))
  })

  it('treats run.updated without terminal status as running', () => {
    const rec = normalizeRunEvent({ event: 'run.updated', data: { id: 'a' } })
    expect(rec.status).toBe('running')
  })

  it('maps error status to failed', () => {
    const rec = normalizeRunEvent({
      event: 'run.completed',
      data: { id: 'a', status: 'error', error: 'crash' },
    })
    expect(rec.status).toBe('failed')
    expect(rec.error).toBe('crash')
  })
})

describe('parseSseEvent', () => {
  it('parses valid payloads and rejects malformed ones', () => {
    expect(parseSseEvent('{"event":"run.started","data":{"id":"a"}}')?.data.id).toBe('a')
    expect(parseSseEvent('not json')).toBeNull()
    expect(parseSseEvent('{"event":"run.started"}')).toBeNull() // no data.id
  })
})

// Reconnect/catch-up scenario from the spec: drop → reconnect → hydrate → deltas.
describe('drop-reconnect-catchup scenario', () => {
  it('restores state without losing events seen offline', () => {
    const s = freshStore()
    s.applyEvent(started('a', 100))
    // Connection drops; meanwhile run 'a' finished and run 'b' started.
    // On reconnect we fetch REST history...
    s.hydrate([
      { id: 'b', status: 'running', startedAt: 200, endedAt: null, summary: 'task b' },
    ])
    s.applyEvent(completed('a', 300)) // late-arriving delta for pre-drop run
    const ids = s.getRunsSnapshot().map((r) => r.id)
    expect(ids).toContain('a')
    expect(ids).toContain('b')
    expect(s.getRunsSnapshot().find((r) => r.id === 'a')?.status).toBe('completed')
  })
})


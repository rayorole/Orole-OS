import { renderHook, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import {
  DEFAULT_SOURCES,
  formatSpokenSummary,
  useFleetStatus,
  type StatusSources,
} from './useFleetStatus'

type Sources = Record<keyof StatusSources, Mock>

function makeSources(overrides: Partial<Sources> = {}): Sources {
  return {
    fetchActiveAgents: vi.fn().mockResolvedValue(3),
    fetchTasksRunning: vi.fn().mockResolvedValue(2),
    fetchOpenPrs: vi.fn().mockResolvedValue(1),
    ...overrides,
  }
}

describe('formatSpokenSummary', () => {
  it('uses plural forms for counts > 1', () => {
    expect(formatSpokenSummary({ activeAgents: 3, tasksRunning: 2, prsOpen: 1 })).toBe(
      '3 agents active, 2 tasks running, 1 pull request open',
    )
  })

  it('uses singular forms for count of 1', () => {
    expect(formatSpokenSummary({ activeAgents: 1, tasksRunning: 1, prsOpen: 1 })).toBe(
      '1 agent active, 1 task running, 1 pull request open',
    )
  })

  it('handles zeros', () => {
    expect(formatSpokenSummary({ activeAgents: 0, tasksRunning: 0, prsOpen: 0 })).toBe(
      '0 agents active, 0 tasks running, 0 pull requests open',
    )
  })
})

describe('useFleetStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('starts in loading skeleton state', () => {
    const sources = makeSources()
    const { result } = renderHook(() => useFleetStatus(sources, 10_000))
    expect(result.current.loading).toBe(true)
    expect(result.current.stale).toBe(false)
  })

  it('aggregates counts from all three sources', async () => {
    const sources = makeSources()
    const { result } = renderHook(() => useFleetStatus(sources, 10_000))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(result.current).toMatchObject({
      activeAgents: 3,
      tasksRunning: 2,
      prsOpen: 1,
      loading: false,
      stale: false,
    })
    expect(result.current.lastUpdated).not.toBeNull()
    expect(sources.fetchActiveAgents).toHaveBeenCalledOnce()
    expect(sources.fetchTasksRunning).toHaveBeenCalledOnce()
    expect(sources.fetchOpenPrs).toHaveBeenCalledOnce()
  })

  it('polls on the configured interval', async () => {
    const sources = makeSources()
    renderHook(() => useFleetStatus(sources, 5_000))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })

    expect(sources.fetchActiveAgents).toHaveBeenCalledTimes(3) // initial + 2 ticks
  })

  it('marks stale and keeps last-known values when a source fails', async () => {
    const sources = makeSources()
    const { result } = renderHook(() => useFleetStatus(sources, 5_000))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.stale).toBe(false)
    expect(result.current.activeAgents).toBe(3)

    sources.fetchOpenPrs.mockRejectedValue(new Error('connection lost'))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })

    expect(result.current.stale).toBe(true)
    expect(result.current.loading).toBe(false)
    // Last-known values stay visible instead of freezing to zero.
    expect(result.current.activeAgents).toBe(3)
    expect(result.current.prsOpen).toBe(1)
    // The failed source is not re-polled within the same tick.
    expect(sources.fetchActiveAgents).toHaveBeenCalledTimes(2)
  })

  it('clears stale state once the connection recovers', async () => {
    const sources = makeSources()
    const { result } = renderHook(() => useFleetStatus(sources, 5_000))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    sources.fetchActiveAgents.mockRejectedValue(new Error('down'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    expect(result.current.stale).toBe(true)

    sources.fetchActiveAgents.mockResolvedValue(4)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    expect(result.current.stale).toBe(false)
    expect(result.current.activeAgents).toBe(4)
  })

  it('marks stale when even the first load fails', async () => {
    const sources = makeSources({ fetchActiveAgents: vi.fn().mockRejectedValue(new Error('down')) })
    const { result } = renderHook(() => useFleetStatus(sources, 5_000))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(result.current.loading).toBe(false)
    expect(result.current.stale).toBe(true)
    expect(result.current.lastUpdated).toBeNull()
  })

  it('exposes default sources that hit the API endpoints', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ count: 7 }), { status: 200 })),
    )
    vi.stubGlobal('fetch', fetchMock)

    const [agents, tasks, prs] = await Promise.all([
      DEFAULT_SOURCES.fetchActiveAgents(),
      DEFAULT_SOURCES.fetchTasksRunning(),
      DEFAULT_SOURCES.fetchOpenPrs(),
    ])

    expect(agents).toBe(0) // no `active` field -> defaults
    expect(tasks).toBe(7)
    expect(prs).toBe(7)
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      '/api/agents',
      '/api/runs?status=active&count=true',
      '/api/github/pulls?state=open&count=true',
    ])
  })
})

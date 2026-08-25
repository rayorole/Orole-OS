// Fleet-status aggregation hook for the Jarvis status bar (#25).
// Polls agents / runs / open-PR sources, tracks staleness on connection loss,
// and exposes an accurate spoken summary for the Jarvis voice pipeline.

import { useCallback, useEffect, useRef, useState } from 'react'

export interface FleetStatus {
  activeAgents: number
  tasksRunning: number
  prsOpen: number
  /** ISO timestamp of the last successful refresh of any source. */
  lastUpdated: string | null
  /** True while the very first fetch cycle has not completed. */
  loading: boolean
  /** True when a poll cycle failed after at least one success (or timed out). */
  stale: boolean
}

export interface StatusSources {
  fetchActiveAgents: () => Promise<number>
  fetchTasksRunning: () => Promise<number>
  fetchOpenPrs: () => Promise<number>
}

export const DEFAULT_SOURCES: StatusSources = {
  fetchActiveAgents: async () => {
    const res = await fetch('/api/agents')
    if (!res.ok) throw new Error(`agents ${res.status}`)
    const data = (await res.json()) as { active?: number }
    return data.active ?? 0
  },
  fetchTasksRunning: async () => {
    const res = await fetch('/api/runs?status=active&count=true')
    if (!res.ok) throw new Error(`runs ${res.status}`)
    const data = (await res.json()) as { count?: number }
    return data.count ?? 0
  },
  fetchOpenPrs: async () => {
    const res = await fetch('/api/github/pulls?state=open&count=true')
    if (!res.ok) throw new Error(`pulls ${res.status}`)
    const data = (await res.json()) as { count?: number }
    return data.count ?? 0
  },
}

const INITIAL: FleetStatus = {
  activeAgents: 0,
  tasksRunning: 0,
  prsOpen: 0,
  lastUpdated: null,
  loading: true,
  stale: false,
}

/** Human-readable summary spoken by the Jarvis TTS pipeline. */
export function formatSpokenSummary(status: Pick<FleetStatus, 'activeAgents' | 'tasksRunning' | 'prsOpen'>): string {
  const agents = `${status.activeAgents} agent${status.activeAgents === 1 ? '' : 's'} active`
  const tasks = `${status.tasksRunning} task${status.tasksRunning === 1 ? '' : 's'} running`
  const prs = `${status.prsOpen} pull request${status.prsOpen === 1 ? '' : 's'} open`
  return `${agents}, ${tasks}, ${prs}`
}

/**
 * Polls all three fleet sources on one interval. Any source failure marks the
 * whole bar stale (last-known values stay visible); a subsequent success
 * clears it. Values are kept between cycles so the UI never freezes to zeros.
 */
export function useFleetStatus(sources: StatusSources = DEFAULT_SOURCES, intervalMs = 10_000): FleetStatus {
  const [status, setStatus] = useState<FleetStatus>(INITIAL)
  const sourcesRef = useRef(sources)
  sourcesRef.current = sources

  const poll = useCallback(async () => {
    try {
      const results = await Promise.all([
        sourcesRef.current.fetchActiveAgents(),
        sourcesRef.current.fetchTasksRunning(),
        sourcesRef.current.fetchOpenPrs(),
      ])
      setStatus({
        activeAgents: results[0],
        tasksRunning: results[1],
        prsOpen: results[2],
        lastUpdated: new Date().toISOString(),
        loading: false,
        stale: false,
      })
    } catch {
      setStatus((prev) => ({
        ...prev,
        // First load failed too: drop out of skeleton but show stale state.
        loading: false,
        stale: true,
        lastUpdated: prev.lastUpdated ?? null,
      }))
    }
  }, [])

  useEffect(() => {
    void poll()
    const id = setInterval(() => void poll(), intervalMs)
    return () => clearInterval(id)
  }, [poll, intervalMs])

  return status
}

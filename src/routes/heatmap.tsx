import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'

import { RunHeatmap } from '#/components/run-heatmap'
import type { HeatmapRun } from '#/lib/heatmap'
import { liveRunStore } from '#/lib/use-live-runs'

export const Route = createFileRoute('/heatmap')({
  component: HeatmapPage,
})

const RUNS_API_BASE: string =
  (typeof import.meta !== 'undefined' &&
    (import.meta.env.VITE_HERMES_API_URL as string | undefined)) ||
  'https://os.orole.be'

/** Fetch historical finished runs for the heatmap window. */
async function fetchRuns(): Promise<HeatmapRun[]> {
  try {
    const res = await fetch(`${RUNS_API_BASE}/v1/runs?limit=500`)
    if (!res.ok) return []
    const body: unknown = await res.json()
    const list: unknown[] = Array.isArray(body)
      ? body
      : ((body as { runs?: unknown[] })?.runs ?? [])
    return list
      .map((r) => {
        const run = r as {
          id?: string
          status?: string
          createdAt?: string
          endedAt?: string
          updatedAt?: string
        }
        const raw = run.endedAt ?? run.updatedAt ?? run.createdAt ?? null
        const endedAt = raw ? Date.parse(raw) : null
        return {
          id: run.id ?? '',
          status: run.status,
          endedAt: Number.isFinite(endedAt as number) ? endedAt : null,
        }
      })
      .filter((r) => r.endedAt !== null)
  } catch {
    return []
  }
}

/**
 * Live SSE subscription to the Runs API so today's cell updates without a
 * refresh. Mirrors the reconnect pattern used by the activity feed.
 */
function useLiveRunStream() {
  useEffect(() => {
    let es: EventSource | undefined
    let disposed = false
    let retry = 0

    // REST catch-up first, then attach the stream.
    fetchRuns().then((runs) => {
      if (!disposed && runs.length > 0)
        liveRunStore.setRuns(
          runs.map((r) => ({ id: r.id ?? '', status: r.status, endedAt: r.endedAt })),
        )
    })

    function connect() {
      if (disposed) return
      es = new EventSource(`${RUNS_API_BASE}/v1/runs/events`)
      es.onmessage = (msg) => {
        try {
          const parsed = JSON.parse(msg.data) as {
            event?: string
            data?: { id?: string; status?: string; endedAt?: string | number | null }
          }
          if (!parsed?.data?.id) return
          liveRunStore.applyEvent({
            event: (parsed.event as 'run.completed') ?? 'run.completed',
            data: {
              id: parsed.data.id,
              status: parsed.data.status,
              endedAt:
                parsed.data.endedAt ??
                (parsed.event === 'run.completed' || parsed.event === 'run.updated'
                  ? Date.now()
                  : null),
            },
          })
        } catch {
          // malformed frame — ignore
        }
      }
      es.onerror = () => {
        es?.close()
        if (disposed) return
        const delay = Math.min(30_000, 1000 * 2 ** retry++)
        setTimeout(connect, delay)
      }
      es.onopen = () => {
        retry = 0
      }
    }
    connect()

    return () => {
      disposed = true
      es?.close()
    }
  }, [])
}

function HeatmapPage() {
  const [historical, setHistorical] = useState<HeatmapRun[]>([])
  useLiveRunStream()

  useEffect(() => {
    let disposed = false
    fetchRuns().then((runs) => {
      if (!disposed) setHistorical(runs)
    })
    return () => {
      disposed = true
    }
  }, [])

  // Click-to-filter of the activity feed (#5) is deferred — the feed lives on
  // a separate route owned by another card. The onSelectDay callback seam is
  // wired through RunHeatmap so wiring it up later is a one-liner.
  const onSelectDay = (_key: string) => {}

  return (
    <div className="hud-page flex flex-1 flex-col gap-6 py-10">
      <div className="space-y-1">
        <p className="hud-panel-title">telemetry</p>
        <h1 className="text-2xl font-bold">Success / failure heatmap</h1>
      </div>
      <RunHeatmap runs={historical} onSelectDay={onSelectDay} />
    </div>
  )
}

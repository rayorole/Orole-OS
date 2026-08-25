import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchMessages,
  messageToEntries,
  RunEventStream,
  type HermesSession,
} from '#/lib/hermes'
import {
  initReducerState,
  reducePuppetEvent,
  type ReducerState,
  type TranscriptEntry,
} from '#/lib/puppet-reducer'
import type { ConnState } from '#/components/PuppetScroller'

const MAX_LINES = 1000

/**
 * usePuppetView — agent puppet-view state machine.
 *
 * 1. Hydrate instantly from GET /api/sessions/{id}/messages (history renders
 *    whole — no slow replay of old content).
 * 2. Tail the session's run over SSE via the #12 RunEventStream, folding
 *    events through the idempotent reducer (duplicate event ids on reconnect
 *    are dropped).
 * 3. Cap scrollback at ~1000 entries.
 */
export function usePuppetView(session: HermesSession | null, runId?: string | null) {
  const [state, setState] = useState<ReducerState>(() => initReducerState())
  const [conn, setConn] = useState<ConnState>('idle')
  const [loadingHistory, setLoadingHistory] = useState(false)
  const streamRef = useRef<RunEventStream | null>(null)

  // History hydration.
  useEffect(() => {
    if (!session?.id) return
    let cancelled = false
    setState(initReducerState())
    setLoadingHistory(true)
    fetchMessages(session.id)
      .then((msgs) => {
        if (cancelled) return
        const hist = msgs.flatMap(messageToEntries) as TranscriptEntry[]
        setState((s) => cap({ ...s, entries: hist }))
      })
      .catch(() => {
        if (cancelled) return
        setState((s) =>
          cap(
            reducePuppetEvent(s, {
              event: '__system',
              data: { text: `⚠ could not load history for session ${session.id}` },
            }),
          ),
        )
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false)
      })
    return () => {
      cancelled = true
    }
  }, [session?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Live SSE tail.
  useEffect(() => {
    if (!runId) {
      setConn('idle')
      return
    }
    const stream = new RunEventStream(runId, {
      onState: setConn as (s: import('#/lib/hermes').ConnState) => void,
      onEvent: (ev) =>
        setState((prev) =>
          cap(reducePuppetEvent(prev, { event: ev.event, data: ev.data, id: evRawId(ev.raw, ev.data) })),
        ),
    })
    streamRef.current = stream
    stream.start()
    return () => {
      stream.stop()
      streamRef.current = null
    }
  }, [runId])

  const reset = useCallback(() => setState(initReducerState()), [])

  return useMemo(
    () => ({
      entries: state.entries,
      conn,
      loadingHistory,
      maxLines: MAX_LINES,
      reset,
    }),
    [state.entries, conn, loadingHistory, reset],
  )
}

/** Extract an id from common shapes so reconnect dedup works without server ids too. */
function evRawId(_raw: string, data: Record<string, unknown>): string | undefined {
  const v = data?.id ?? data?.event_id ?? null
  return v == null ? undefined : String(v)
}

function cap(s: ReducerState): ReducerState {
  if (s.entries.length <= MAX_LINES) return s
  return { ...s, entries: s.entries.slice(-MAX_LINES) }
}

// Re-export for route usage convenience.
export type { TranscriptEntry }

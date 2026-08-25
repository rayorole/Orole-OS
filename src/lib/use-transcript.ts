import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchMessages,
  messageToEntries,
  RunEventStream,
  summarizeArgs,
  type ConnState,
  type HermesSession,
  type TranscriptEntry,
  makeKey,
} from '#/lib/hermes'

/**
 * useTranscript — per-session live transcript state machine.
 *
 * Backfills history via GET /api/sessions/{id}/messages, then tails the
 * session's latest run over SSE (GET /v1/runs/{id}/events) with exponential-
 * backoff reconnect. Handles assistant.delta (incremental streaming text),
 * tool.started / tool.completed blocks, and generic lifecycle events.
 */
export function useTranscript(session: HermesSession | null, runId?: string | null) {
  const [entries, setEntries] = useState<TranscriptEntry[]>([])
  const [conn, setConn] = useState<ConnState>('idle')
  const [loadingHistory, setLoadingHistory] = useState(false)
  const streamRef = useRef<RunEventStream | null>(null)

  const appendEntries = useCallback((next: TranscriptEntry[]) => {
    setEntries((prev) => [...prev, ...next])
  }, [])

  // Historical backfill on session change.
  useEffect(() => {
    if (!session?.id) return
    let cancelled = false
    setEntries([])
    setLoadingHistory(true)
    fetchMessages(session.id)
      .then((msgs) => {
        if (cancelled) return
        const hist = msgs.flatMap(messageToEntries)
        setEntries(hist)
      })
      .catch(() => {
        if (cancelled) return
        appendEntries([
          {
            key: makeKey('sys'),
            kind: 'system',
            text: `⚠ could not load history for session ${session.id}`,
          },
        ])
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false)
      })
    return () => {
      cancelled = true
    }
  }, [session?.id, appendEntries]) // eslint-disable-line react-hooks/exhaustive-deps

  // Live SSE tail on run change.
  useEffect(() => {
    if (!runId) {
      setConn('idle')
      return
    }
    const stream = new RunEventStream(runId, {
      onState: setConn,
      onEvent: (ev) =>
        setEntries((prev) => applyRunEvent(prev, ev.event, ev.data)),
    })
    streamRef.current = stream
    stream.start()
    return () => {
      stream.stop()
      streamRef.current = null
    }
  }, [runId])

  const reset = useCallback(() => setEntries([]), [])

  return useMemo(
    () => ({ entries, conn, loadingHistory, reset }),
    [entries, conn, loadingHistory, reset],
  )
}

/**
 * Fold a single SSE run event into the entry list.
 * Exported for tests.
 */
export function applyRunEvent(
  prev: TranscriptEntry[],
  event: string,
  data: Record<string, unknown>,
): TranscriptEntry[] {
  const text = typeof data.text === 'string' ? data.text : typeof data.delta === 'string' ? data.delta : ''

  switch (event) {
    case 'assistant.delta':
    case 'response.output_text.delta': {
      if (!text) return prev
      const last = prev[prev.length - 1]
      if (last && last.kind === 'assistant' && last.streaming) {
        // Grow the in-flight streaming bubble.
        return [...prev.slice(0, -1), { ...last, text: last.text + text }]
      }
      return [
        ...prev,
        { key: makeKey('live'), kind: 'assistant', streaming: true, text },
      ]
    }

    case 'run.completed':
    case 'message.completed': {
      // Seal any still-streaming bubble.
      return prev.map((e) => (e.streaming ? { ...e, streaming: false } : e))
    }

    case 'tool.started':
    case 'hermes.tool.progress': {
      const name = str(data.tool ?? data.name ?? 'tool')
      const args =
        (typeof data.args === 'object' && data.args !== null
          ? summarizeArgs(data.args as Record<string, unknown>)
          : str(data.args_summary)) || '(starting…)'
      return [
        ...prev.map((e) => (e.streaming ? { ...e, streaming: false } : e)),
        {
          key: makeKey('tool'),
          kind: 'tool',
          ts: nowTs(),
          text: '',
          tool: { name, argsSummary: args, status: 'running' },
        },
      ]
    }

    case 'tool.completed': {
      const name = str(data.tool ?? data.name ?? '')
      const result = str(data.result ?? data.output ?? data.summary ?? '')
      const isError =
        data.ok === false ||
        str(data.status).toLowerCase() === 'error' ||
        str(data.status).toLowerCase() === 'failed'
      // Attach to the newest matching running tool block; else new block.
      const idx = [...prev].reverse().findIndex(
        (e) =>
          e.kind === 'tool' &&
          e.tool &&
          e.tool.status === 'running' &&
          (!name || e.tool.name === name),
      )
      if (idx !== -1) {
        const realIdx = prev.length - 1 - idx
        return prev.map((e, i) =>
          i === realIdx && e.tool
            ? {
                ...e,
                tool: {
                  ...e.tool,
                  status: isError ? 'error' : 'ok',
                  result: result || undefined,
                },
              }
            : e,
        )
      }
      return [
        ...prev,
        {
          key: makeKey('tool'),
          kind: 'tool',
          ts: nowTs(),
          text: '',
          tool: { name: name || 'tool', argsSummary: '', status: isError ? 'error' : 'ok', result: result || undefined },
        },
      ]
    }

    case 'subagent.start':
    case 'subagent.complete':
    case 'run.started':
    case 'run.failed':
    case 'run.cancelled': {
      const summary = str(data.summary ?? data.status ?? data.error ?? '')
      return [
        ...prev.map((e) => (e.streaming ? { ...e, streaming: false } : e)),
        {
          key: makeKey('event'),
          kind: 'event',
          ts: nowTs(),
          text: `${event}${summary ? ` — ${summary}` : ''}`,
        },
      ]
    }

    default:
      return prev
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}

function nowTs(): string {
  return new Date().toISOString()
}

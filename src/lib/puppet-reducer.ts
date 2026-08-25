/**
 * Puppet-view SSE reducer — pure fold of Hermes run events into transcript
 * entries. Idempotent by event id: replaying or reconnecting with duplicate
 * events never duplicates content.
 *
 * Exported pure so vitest can cover it directly.
 */

export type EntryKind = 'user' | 'assistant' | 'system' | 'tool' | 'event'

export interface ToolInfo {
  name: string
  argsSummary: string
  status: 'running' | 'ok' | 'error'
  /** Full input JSON (stringified) for the expanded chip view. */
  inputJson?: string
  /** Full output JSON/text for the expanded chip view. */
  outputJson?: string
}

export interface TranscriptEntry {
  key: string
  kind: EntryKind
  ts?: string
  text: string
  streaming?: boolean
  tool?: ToolInfo
}

/** A parsed SSE event handed to the reducer. */
export interface PuppetEvent {
  event: string
  data: Record<string, unknown>
  /** Server-provided unique event id; when absent we derive a fallback key. */
  id?: string
}

let entrySeq = 0
function makeKey(prefix: string): string {
  entrySeq += 1
  return `${prefix}-${entrySeq}`
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}

/** Human-readable one-line summary of tool arguments. */
export function summarizeArgs(args: Record<string, unknown>): string {
  const parts: string[] = []
  if (typeof args.command === 'string') parts.push(`$ ${args.command}`)
  else if (args.cmd !== undefined) parts.push(`$ ${String(args.cmd)}`)
  for (const k of ['path', 'file_path', 'file', 'notebook_path']) {
    if (typeof args[k] === 'string') parts.push(String(args[k]))
  }
  if (typeof args.pattern === 'string') parts.push(`/${args.pattern}/`)
  if (typeof args.query === 'string') parts.push(`"${args.query}"`)
  if (!parts.length) {
    const rest = Object.keys(args)
      .filter((k) => !['command', 'cmd'].includes(k))
      .slice(0, 3)
    for (const k of rest) {
      const v = String(args[k])
      parts.push(`${k}=${v.length > 60 ? `${v.slice(0, 60)}…` : v}`)
    }
  }
  return parts.join(' · ') || '(no arguments)'
}

/** Stable identity for an SSE event — the dedup key used by the reducer. */
export function eventId(ev: PuppetEvent): string {
  const raw = ev.id ?? ev.data?.id ?? ev.data?.event_id ?? null
  if (raw != null && str(raw)) return `id:${str(raw)}`
  // No server id: fall back to content+sequence so at least exact replays
  // of the same frame position collapse. Position is supplied by caller via
  // seenIds bookkeeping order — here we use a positional counter passed in
  // state, keyed by event name + data length as a weak heuristic.
  return `pos:${ev.event}:${JSON.stringify(ev.data).slice(0, 120)}`
}

const MAX_SEEN = 2048

/**
 * Reducer state carried across folds. Seen-event-id ring buffer gives
 * idempotency across SSE reconnects (server replays from Last-Event-ID).
 */
export interface ReducerState {
  entries: TranscriptEntry[]
  seenIds: Set<string>
}

export function initReducerState(history: TranscriptEntry[] = []): ReducerState {
  return { entries: history, seenIds: new Set() }
}

/** Fold one event; returns the SAME state object if nothing changed. */
export function reducePuppetEvent(state: ReducerState, ev: PuppetEvent): ReducerState {
  const eid = eventId(ev)
  if (state.seenIds.has(eid)) return state

  const entries = applyRunEvent(state.entries, ev.event, ev.data)
  const seenIds =
    state.seenIds.size >= MAX_SEEN
      ? new Set([...state.seenIds].slice(-Math.floor(MAX_SEEN / 2)))
      : new Set(state.seenIds)
  seenIds.add(eid)

  return { entries, seenIds }
}

/** Fold a batch of events (history hydration path can reuse this). */
export function reducePuppetEvents(state: ReducerState, events: PuppetEvent[]): ReducerState {
  let cur = state
  for (const ev of events) cur = reducePuppetEvent(cur, ev)
  return cur
}

// ── Per-event folding (shared logic with #12's applyRunEvent) ────────────────

export function applyRunEvent(
  prev: TranscriptEntry[],
  event: string,
  data: Record<string, unknown>,
): TranscriptEntry[] {
  const text =
    typeof data.text === 'string' ? data.text : typeof data.delta === 'string' ? data.delta : ''

  switch (event) {
    case 'assistant.delta':
    case 'response.output_text.delta': {
      if (!text) return prev
      const last = prev[prev.length - 1]
      if (last && last.kind === 'assistant' && last.streaming) {
        return [...prev.slice(0, -1), { ...last, text: last.text + text }]
      }
      return [...prev, { key: makeKey('live'), kind: 'assistant', streaming: true, text }]
    }

    case 'run.completed':
    case 'message.completed': {
      if (!prev.some((e) => e.streaming)) return prev
      return prev.map((e) => (e.streaming ? { ...e, streaming: false } : e))
    }

    case 'tool.started':
    case 'hermes.tool.progress': {
      const name = str(data.tool ?? data.name ?? 'tool')
      const inputObj =
        typeof data.args === 'object' && data.args !== null
          ? (data.args as Record<string, unknown>)
          : {}
      return [
        ...prev.map((e) => (e.streaming ? { ...e, streaming: false } : e)),
        {
          key: makeKey('tool'),
          kind: 'tool',
          ts: nowTs(),
          text: '',
          tool: {
            name,
            argsSummary: summarizeArgs(inputObj),
            status: 'running',
            inputJson: Object.keys(inputObj).length ? JSON.stringify(inputObj, null, 2) : undefined,
          },
        },
      ]
    }

    case 'tool.completed': {
      const name = str(data.tool ?? data.name ?? '')
      const resultRaw = data.result ?? data.output ?? data.summary
      const isError =
        data.ok === false ||
        str(data.status).toLowerCase() === 'error' ||
        str(data.status).toLowerCase() === 'failed'

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
                  outputJson:
                    typeof resultRaw === 'object' && resultRaw !== null
                      ? JSON.stringify(resultRaw, null, 2)
                      : resultRaw != null && resultRaw !== ''
                        ? String(resultRaw)
                        : e.tool.outputJson,
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
          tool: {
            name: name || 'tool',
            argsSummary: '',
            status: isError ? 'error' : 'ok',
            outputJson:
              typeof resultRaw === 'object' && resultRaw !== null
                ? JSON.stringify(resultRaw, null, 2)
                : str(resultRaw),
          },
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

function nowTs(): string {
  return new Date().toISOString()
}

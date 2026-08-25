/**
 * Hermes gateway API client for the per-agent live transcript view.
 *
 * Endpoints used (see https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server):
 *  - GET  /api/sessions                      → session/profile list (agent selector)
 *  - GET  /api/sessions/{id}/messages        → historical transcript backfill
 *  - GET  /v1/runs/{id}/events               → SSE stream of run events (live tail)
 *  - GET  /v1/capabilities                   → feature discovery
 */

export const HERMES_BASE_URL = (import.meta.env.VITE_HERMES_BASE_URL ?? '').replace(/\/$/, '')
export const HERMES_API_KEY = import.meta.env.VITE_HERMES_API_KEY ?? ''

function url(path: string): string {
  return `${HERMES_BASE_URL}${path}`
}

function headers(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/json', ...extra }
  if (HERMES_API_KEY) h.Authorization = `Bearer ${HERMES_API_KEY}`
  return h
}

async function requestJson<T>(path: string): Promise<T> {
  const res = await fetch(url(path), { headers: headers() })
  if (!res.ok) throw new Error(`${path} failed: HTTP ${res.status}`)
  return (await res.json()) as T
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface HermesSession {
  id: string
  title?: string
  source?: string
  created_at?: string
  updated_at?: string
}

export interface HermesMessage {
  id?: number | string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: unknown
  created_at?: string
  [k: string]: unknown
}

export interface Capabilities {
  features?: Record<string, boolean>
  endpoints?: Record<string, unknown>
}

// Normalized transcript entry kinds rendered by the panel.

export type EntryKind = 'user' | 'assistant' | 'system' | 'tool' | 'event'

export interface ToolInfo {
  name: string
  argsSummary: string
  status: 'running' | 'ok' | 'error'
  result?: string
}

export interface TranscriptEntry {
  key: string
  kind: EntryKind
  ts?: string
  text: string
  streaming?: boolean
  tool?: ToolInfo
}

let entrySeq = 0
export function makeKey(prefix: string): string {
  entrySeq += 1
  return `${prefix}-${Date.now().toString(36)}-${entrySeq}`
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    // OpenAI-style content parts: [{type:'text', text:'…'}, …]
    return content
      .map((p) =>
        typeof p === 'object' && p !== null && 'text' in p
          ? String((p as Record<string, unknown>).text)
          : JSON.stringify(p),
      )
      .join('')
  }
  if (content == null) return ''
  return JSON.stringify(content)
}

/** Normalize one message row from GET /api/sessions/{id}/messages. */
export function messageToEntries(m: HermesMessage): TranscriptEntry[] {
  const out: TranscriptEntry[] = []
  const ts = typeof m.created_at === 'string' ? m.created_at : undefined
  const role = m.role

  // Structured assistant turns may carry tool_calls blocks.
  const toolCalls =
    role === 'assistant' && Array.isArray(m.tool_calls)
      ? (m.tool_calls as Array<Record<string, unknown>>)
      : []

  for (const tc of toolCalls) {
    const fn = (tc.function ?? {}) as Record<string, unknown>
    let argsSummary = ''
    try {
      argsSummary = summarizeArgs(JSON.parse(String(fn.arguments ?? '{}')))
    } catch {
      argsSummary = String(fn.arguments ?? '')
    }
    out.push({
      key: makeKey('hist-tool'),
      kind: 'tool',
      ts,
      text: '',
      tool: {
        name: String(fn.name ?? tc.name ?? 'tool'),
        argsSummary,
        status: 'ok',
        result: undefined,
      },
    })
  }

  const text = contentToText(m.content)
  if (text || (!out.length && role)) {
    out.push({
      key: makeKey(`hist-${role}`),
      kind: (role === 'user' || role === 'assistant' || role === 'system' ? role : 'system') as EntryKind,
      ts,
      text,
    })
  }
  return out
}

/** Human-readable one-line summary of tool arguments (commands, file paths…). */
export function summarizeArgs(args: Record<string, unknown>): string {
  const parts: string[] = []
  if (typeof args.command === 'string') parts.push(`$ ${args.command}`)
  else if (args.cmd !== undefined) parts.push(`$ ${String(args.cmd)}`)
  for (const k of ['path', 'file_path', 'file', 'notebook_path']) {
    if (typeof args[k] === 'string') parts.push(String(args[k]))
  }
  if (typeof args.pattern === 'string') parts.push(`/​${args.pattern}/`)
  if (typeof args.query === 'string') parts.push(`“${args.query}”`)
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

// ── REST calls ───────────────────────────────────────────────────────────────

export async function fetchSessions(): Promise<HermesSession[]> {
  const data = await requestJson<unknown>('/api/sessions')
  const rows = Array.isArray(data)
    ? data
    : ((data as Record<string, unknown>).sessions as unknown[]) ?? []
  return rows.filter((r): r is HermesSession => !!r && typeof r === 'object').map((r) => {
    const s = r as unknown as Record<string, unknown>
    return {
      id: String(s.id ?? s.session_id ?? ''),
      title: typeof s.title === 'string' ? s.title : undefined,
      source: typeof s.source === 'string' ? s.source : undefined,
      created_at: typeof s.created_at === 'string' ? s.created_at : undefined,
      updated_at: typeof s.updated_at === 'string' ? s.updated_at : undefined,
    }
  })
}

export async function fetchMessages(sessionId: string): Promise<HermesMessage[]> {
  const data = await requestJson<unknown>(`/api/sessions/${encodeURIComponent(sessionId)}/messages`)
  const rows = Array.isArray(data)
    ? data
    : ((data as Record<string, unknown>).messages as unknown[]) ?? []
  return rows as HermesMessage[]
}

export async function fetchCapabilities(): Promise<Capabilities> {
  try {
    return await requestJson<Capabilities>('/v1/capabilities')
  } catch {
    return {}
  }
}

// ── SSE (fetch-based so we can send the Authorization header + reconnect) ────

export type ConnState = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'offline'

export interface RunEvent {
  event: string
  data: Record<string, unknown>
  raw: string
}

export class RunEventStream {
  private abort = new AbortController()
  private stopped = false
  private attempts = 0

  constructor(
    private runId: string,
    private handlers: {
      onEvent: (ev: RunEvent) => void
      onState: (state: ConnState) => void
    },
  ) {}

  start() {
    this.stopped = false
    void this.connect()
  }

  stop() {
    this.stopped = true
    this.abort.abort()
  }

  private async connect() {
    if (this.stopped) return
    this.handlers.onState(this.attempts === 0 ? 'connecting' : 'reconnecting')
    try {
      const res = await fetch(url(`/v1/runs/${encodeURIComponent(this.runId)}/events`), {
        headers: headers({ Accept: 'text/event-stream' }),
        signal: this.abort.signal,
      })
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
      this.attempts = 0
      this.handlers.onState('live')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        let idx: number
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, idx)
          buf = buf.slice(idx + 2)
          const ev = parseSseFrame(frame)
          if (ev) this.handlers.onEvent(ev)
        }
      }
      // Server closed the stream — treat like a drop and retry.
      throw new Error('stream ended')
    } catch (err) {
      if (this.stopped || (err instanceof DOMException && err.name === 'AbortError')) return
      this.attempts += 1
      const delay = Math.min(15000, 1000 * 2 ** Math.min(this.attempts, 4))
      this.handlers.onState(delay >= 8000 ? 'offline' : 'reconnecting')
      setTimeout(() => void this.connect(), delay)
    }
  }
}

export function parseSseFrame(frame: string): RunEvent | null {
  let event = 'message'
  const dataLines: string[] = []
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
  }
  if (!dataLines.length && event === 'message') return null
  const raw = dataLines.join('\n')
  let data: Record<string, unknown>
  try {
    data = JSON.parse(raw) as Record<string, unknown>
  } catch {
    data = { text: raw }
  }
  return { event, data, raw }
}

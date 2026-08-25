/**
 * Orole-OS API client — thin, typed wrapper around fetch for the Hermes
 * gateway at os.orole.be. All failures are normalized to the shared failure
 * taxonomy in ./errors before they reach the UI.
 */
import {
  AuthFailedError,
  NetworkOrCorsError,
  NoApiKeyError,
  ServerError,
} from './errors'

export const GATEWAY_BASE = 'https://os.orole.be'

export interface RequestOptions {
  /** Bearer token attached as `Authorization: Bearer <key>`. Required unless allowNoAuth. */
  apiKey?: string | null
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  headers?: Record<string, string>
  signal?: AbortSignal
}

/** Build the final URL + headers for a gateway request (exposed for tests). */
export function buildRequest(path: string, opts: RequestOptions = {}) {
  const url = `${GATEWAY_BASE}${path}`
  const headers: Record<string, string> = { ...opts.headers }
  if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  return { url, headers, method: opts.method ?? 'GET' }
}

async function parseErrorBody(res: Response): Promise<never> {
  if (res.status === 401 || res.status === 403) throw new AuthFailedError()
  if (res.status >= 500) throw new ServerError(res.status)
  let detail = ''
  try {
    const data = await res.json()
    detail =
      typeof data?.error === 'string'
        ? `: ${data.error}`
        : typeof data?.message === 'string'
          ? `: ${data.message}`
          : ''
  } catch {
    // non-JSON error body — fall through with empty detail
  }
  throw new Error(`Unexpected status ${res.status}${detail}`)
}

/**
 * Perform a JSON request against the gateway.
 * - missing key      -> NoApiKeyError
 * - network failure  -> NetworkOrCorsError
 * - 401/403          -> AuthFailedError
 * - 5xx              -> ServerError(status)
 * - other non-2xx    -> generic Error with status detail
 */
export async function apiFetch<T = unknown>(
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  if (!opts.apiKey) throw new NoApiKeyError()

  const { url, headers, method } = buildRequest(path, opts)
  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    })
  } catch {
    throw new NetworkOrCorsError()
  }

  if (!res.ok) await parseErrorBody(res)
  try {
    return (await res.json()) as T
  } catch {
    throw new Error(`Malformed JSON response from ${path}`)
  }
}

/* ── SSE ─────────────────────────────────────────────────────────────────── */

export type SseEvent =
  | { type: 'assistant.delta'; text: string }
  | { type: 'tool.started'; tool: string; callId?: string }
  | { type: 'tool.completed'; tool: string; ok?: boolean; callId?: string }
  | { type: string; [k: string]: unknown }

/**
 * Parse one server-sent-events chunk into typed events.
 * Handles multi-line `data:` frames and `event:` prefixes; ignores comments,
 * heartbeats (: ping) and blank frames. Malformed JSON lines are skipped.
 */
export function parseSseChunk(chunk: string): SseEvent[] {
  const events: SseEvent[] = []
  const frames = chunk.split('\n\n')

  for (const frame of frames) {
    const lines = frame.split('\n')
    let eventName = 'message'
    const dataLines: string[] = []

    for (const line of lines) {
      if (line.startsWith(':')) continue // comment / heartbeat
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim()
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart())
      }
    }
    if (dataLines.length === 0) continue

    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(dataLines.join('\n'))
    } catch {
      continue // malformed payload — never crash the stream consumer
    }
    if (eventName !== 'message') payload.type = payload.type ?? eventName
    events.push(payload as SseEvent)
  }
  return events
}

export interface SseHandlers {
  onDelta?: (text: string) => void
  onToolStarted?: (tool: string, callId?: string) => void
  onToolCompleted?: (tool: string, ok?: boolean, callId?: string) => void
  onRaw?: (event: SseEvent) => void
}

/** Consume parsed SSE events through typed callbacks. */
export function handleSseEvents(events: SseEvent[], handlers: SseHandlers) {
  for (const ev of events) {
    handlers.onRaw?.(ev)
    switch (ev.type) {
      case 'assistant.delta':
        handlers.onDelta?.((ev as { text?: string }).text ?? '')
        break
      case 'tool.started': {
        const e = ev as { tool?: string; callId?: string }
        handlers.onToolStarted?.(e.tool ?? '', e.callId)
        break
      }
      case 'tool.completed': {
        const e = ev as { tool?: string; ok?: boolean; callId?: string }
        handlers.onToolCompleted?.(e.tool ?? '', e.ok, e.callId)
        break
      }
    }
  }
}

/**
 * Subscribe to an SSE endpoint over fetch streaming (works where EventSource
 * can't set auth headers). Returns an unsubscribe function that aborts the
 * request; the reader loop settles after abort.
 */
export function subscribeSse(
  path: string,
  apiKey: string | null,
  handlers: SseHandlers & { onError?: (err: unknown) => void },
): () => void {
  const controller = new AbortController()

  ;(async () => {
    try {
      if (!apiKey) throw new NoApiKeyError()
      const res = await fetch(`${GATEWAY_BASE}${path}`, {
        headers: {
          Accept: 'text/event-stream',
          Authorization: `Bearer ${apiKey}`,
        },
        signal: controller.signal,
      })
      if (!res.ok || !res.body) await parseErrorBody(res)

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        // Emit only complete frames; keep trailing partial frame buffered.
        const lastBoundary = buffer.lastIndexOf('\n\n')
        if (lastBoundary !== -1) {
          const ready = buffer.slice(0, lastBoundary + 2)
          buffer = buffer.slice(lastBoundary + 2)
          handleSseEvents(parseSseChunk(ready), handlers)
        }
      }
      handleSseEvents(parseSseChunk(buffer), handlers)
    } catch (err) {
      if (!controller.signal.aborted) handlers.onError?.(err)
    }
  })()

  return () => controller.abort()
}

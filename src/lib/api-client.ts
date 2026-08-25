/**
 * Orole-OS API client (issue #32).
 *
 * All requests go through the same-origin server proxy (/api/gateway/*) and
 * are authenticated by the httpOnly session cookie. The browser holds no key.
<<<<<<< HEAD
 *
 * SSE helpers retained from the test-coverage work (#14): typed event
 * parsing and fetch-stream subscription, reused by hooks.ts.
=======
>>>>>>> origin/feat/test-coverage-vitest-e2e
 */

import { getCsrfToken, CSRF_HEADER } from './session-client'

export type ConnectionStatus =
  | 'connected'
  | 'unauthorized'
  | 'network-error'
  | 'server-error'
  | 'no-session'

/** Error carrying a classified connection failure. Never includes secrets. */
export class ApiError extends Error {
  readonly status: ConnectionStatus
  constructor(status: ConnectionStatus, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export interface ModelInfo {
  id: string
  owned_by?: string
}

<<<<<<< HEAD
export interface ModelsResponse {
  data: ModelInfo[]
}

=======
>>>>>>> origin/feat/test-coverage-vitest-e2e
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        ...(getCsrfToken() ? { [CSRF_HEADER]: getCsrfToken() } : {}),
<<<<<<< HEAD
        ...(init?.headers ?? {}),
      },
    })
  } catch {
    throw new ApiError('network-error', "Can't reach the gateway from the browser.")
  }
  if (response.status === 401 || response.status === 403)
    throw new ApiError('unauthorized', 'Session expired or unauthorized.')
  if (!response.ok)
    throw new ApiError('server-error', `Gateway error ${response.status}.`)
  return (await response.json()) as T
}

export async function listModels(): Promise<ModelsResponse> {
  return request<ModelsResponse>('/api/gateway/v1/models')
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
 * Subscribe to an SSE endpoint over the same-origin proxy using fetch
 * streaming. Returns an unsubscribe function that aborts the request; the
 * reader loop settles after abort.
 */
export function subscribeSse(
  path: string,
  _apiKey: string | null,
  handlers: SseHandlers & { onError?: (err: unknown) => void },
): () => void {
  void _apiKey // kept for API compat with pre-#32 callers; auth is cookie-based now
  const controller = new AbortController()

  ;(async () => {
    try {
      const res = await fetch(path, {
        headers: { Accept: 'text/event-stream' },
        credentials: 'same-origin',
        signal: controller.signal,
      })
      if (!res.ok || !res.body)
        throw new ApiError(
          res.status === 401 || res.status === 403 ? 'unauthorized' : 'server-error',
          `Stream error ${res.status}`,
        )

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
=======
        ...(init?.headers as Record<string, string> | undefined),
      },
    })
  } catch {
    throw new ApiError('network-error', 'Could not reach the backend. Check your network.')
  }

  if (!response.ok) {
    if (response.status === 401) throw new ApiError('no-session', 'Session expired — sign in again.')
    if (response.status === 403) throw new ApiError('unauthorized', 'Request rejected (CSRF/permission).')
    throw new ApiError('server-error', `Backend error (HTTP ${response.status}).`)
  }
  return (await response.json()) as T
}

export interface ModelsResponse {
  data?: ModelInfo[]
}

/** Cheap authenticated ping through the session proxy. */
export function listModels(): Promise<ModelsResponse> {
  return request<ModelsResponse>('/api/gateway/v1/models')
}

/**
 * Open an SSE stream over fetch with a bearer stream token (never EventSource,
 * never ?token= in URLs). Re-exports the session-client helper for callers.
 */
export { openEventStream } from './session-client'
>>>>>>> origin/feat/test-coverage-vitest-e2e

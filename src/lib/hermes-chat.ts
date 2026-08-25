/**
 * Hermes gateway text-chat transport.
 *
 * Streams OpenAI-compatible chat completions from the Hermes gateway
 * (`POST {base}/v1/chat/completions`, `stream: true`) and additionally parses
 * non-standard SSE events emitted by the gateway — notably `hermes.tool.progress`
 * — surfacing them through an `onToolProgress` callback so the UI can render
 * inline tool-status blocks while a run is in flight.
 */

export const HERMES_GATEWAY_URL =
  (import.meta.env?.VITE_HERMES_GATEWAY_URL as string | undefined) ??
  'https://os.orole.be'

/** localStorage keys checked for a gateway API key (first hit wins). */
const API_KEY_STORAGE_KEYS = [
  'orole.apiKey',
  'orole_api_key',
  'hermes.apiKey',
  'hermes_api_key',
]

export function resolveApiKey(): string | undefined {
  if (typeof window === 'undefined') return undefined
  const fromEnv = (import.meta.env?.VITE_HERMES_API_KEY as string | undefined)?.trim()
  if (fromEnv) return fromEnv
  for (const key of API_KEY_STORAGE_KEYS) {
    try {
      const value = window.localStorage.getItem(key)
      if (value && value.trim()) return value.trim()
    } catch {
      // localStorage unavailable (private mode etc.) — keep scanning
    }
  }
  return undefined
}

export interface ToolProgressEvent {
  /** Stable id for the tool invocation (SSE `tool_call_id` / `id`, synthesized if absent). */
  toolCallId: string
  /** Human-facing tool name. */
  toolName: string
  /** e.g. "running" | "complete" | "error". */
  status: 'running' | 'complete' | 'error'
  /** Free-form progress detail from the gateway. */
  message?: string
}

export interface StreamCallbacks {
  onDelta: (text: string) => void
  onToolProgress?: (event: ToolProgressEvent) => void
}

export class GatewayError extends Error {
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'GatewayError'
    this.status = status
  }
}

export interface ChatMessageInput {
  role: 'user' | 'assistant' | 'system'
  content: string
}

interface RawToolProgress {
  id?: string
  tool_call_id?: string
  toolCallId?: string
  tool?: string
  tool_name?: string
  toolName?: string
  status?: string
  state?: string
  message?: string
  detail?: string
}

function normalizeToolProgress(raw: RawToolProgress): ToolProgressEvent | null {
  const toolName = raw.tool ?? raw.tool_name ?? raw.toolName
  if (!toolName || typeof toolName !== 'string') return null
  const rawStatus = (raw.status ?? raw.state ?? '').toLowerCase()
  const status: ToolProgressEvent['status'] = rawStatus.includes('err')
    ? 'error'
    : rawStatus.includes('done') ||
        rawStatus.includes('complet') ||
        rawStatus.includes('finish')
      ? 'complete'
      : 'running'
  return {
    toolCallId:
      raw.tool_call_id ?? raw.toolCallId ?? raw.id ?? `tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    toolName,
    status,
    message: typeof raw.message === 'string' ? raw.message : raw.detail,
  }
}

/**
 * POST a streaming chat completion and yield assistant text deltas while
 * forwarding `hermes.tool.progress` SSE frames. Resolves once the stream ends.
 */
export async function streamHermesChat(
  messages: ChatMessageInput[],
  callbacks: StreamCallbacks,
  options: { signal?: AbortSignal } = {},
): Promise<void> {
  const apiKey = resolveApiKey()

  let response: Response
  try {
    response = await fetch(`${HERMES_GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: (import.meta.env?.VITE_HERMES_TEXT_MODEL as string | undefined) ?? 'jarvis',
        messages,
        stream: true,
      }),
      signal: options.signal,
    })
  } catch (cause) {
    if ((cause as Error)?.name === 'AbortError') throw cause
    throw new GatewayError('Could not reach the Hermes gateway. Check your connection.')
  }

  if (!response.ok || !response.body) {
    throw new GatewayError(
      `Hermes gateway returned ${response.status} ${response.statusText || 'Error'}`,
      response.status,
    )
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let sseBuffer = ''

  const dispatchFrame = (frame: string) => {
    // One SSE frame: optional `event:` line(s) + `data:` payload lines.
    const lines = frame.split('\n')
    const eventName = lines
      .filter((l) => l.startsWith('event:'))
      .map((l) => l.slice(6).trim())
      .pop()
    const data = lines
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .join('\n')
    if (!data || data === '[DONE]') return

    let parsed: unknown
    try {
      parsed = JSON.parse(data)
    } catch {
      return // ignore keep-alives / non-JSON frames
    }
    const obj = parsed as Record<string, unknown>

    // Non-standard gateway event (e.g. hermes.tool.progress) either as SSE
    // event name or as an in-band `type` field.
    const type = typeof obj.type === 'string' ? obj.type : eventName ?? ''
    if (type.startsWith('hermes.')) {
      if (type !== 'hermes.tool.progress') return
      const progress = normalizeToolProgress(obj as RawToolProgress)
      if (progress) callbacks.onToolProgress?.(progress)
      return
    }

    // Standard OpenAI chunk shape: choices[0].delta.content
    const delta = (
      (obj.choices as Array<{ delta?: { content?: string }; text?: string }> | undefined)?.[0]
    )
    const text = delta?.delta?.content ?? delta?.text
    if (typeof text === 'string' && text.length > 0) callbacks.onDelta(text)
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      sseBuffer += decoder.decode(value, { stream: true })
      let boundary = sseBuffer.indexOf('\n\n')
      while (boundary !== -1) {
        const frame = sseBuffer.slice(0, boundary)
        sseBuffer = sseBuffer.slice(boundary + 2)
        dispatchFrame(frame.replace(/\r/g, ''))
        boundary = sseBuffer.indexOf('\n\n')
      }
    }
    // Flush any trailing frame without the terminating blank line.
    if (sseBuffer.trim()) dispatchFrame(sseBuffer.replace(/\r/g, ''))
  } finally {
    reader.releaseLock()
  }
}

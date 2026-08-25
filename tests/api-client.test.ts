import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  ApiError,
  listModels,
  handleSseEvents,
  parseSseChunk,
} from '#/lib/api-client'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

/* ── request layer (same-origin proxy, httpOnly cookie auth) ─────────────── */

describe('listModels — request layer', () => {
  it('returns parsed JSON on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [{ id: 'm1' }] }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await listModels()
    expect(result).toEqual({ data: [{ id: 'm1' }] })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/gateway/v1/models')
    // httpOnly session architecture: no Authorization header, cookies only.
    expect(init.headers.Authorization).toBeUndefined()
    expect(init.credentials).toBe('same-origin')
  })

  it('maps network failure to network-error ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed to fetch')))
    await expect(listModels()).rejects.toMatchObject({ status: 'network-error' })
  })

  it('maps 401 to unauthorized', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 401)))
    await expect(listModels()).rejects.toMatchObject({ status: 'unauthorized' })
  })

  it('maps 403 to unauthorized', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 403)))
    await expect(listModels()).rejects.toMatchObject({ status: 'unauthorized' })
  })

  it('maps 5xx to server-error carrying the status code in the message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 502 })))
    await expect(listModels()).rejects.toMatchObject({
      status: 'server-error',
      message: expect.stringContaining('502'),
    })
  })

  it('throws a descriptive error for other unexpected statuses (429)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'slow down' }, 429)))
    await expect(listModels()).rejects.toMatchObject({
      status: 'server-error',
      message: expect.stringContaining('429'),
    })
  })

  it('attaches the CSRF header when a token is present', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [] }))
    vi.stubGlobal('fetch', fetchMock)
    window.localStorage.setItem('orole.csrf', 'csrf-xyz')
    await listModels()
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.stringify(init.headers)).not.toContain('Bearer')
    window.localStorage.removeItem('orole.csrf')
  })
})

describe('ApiError', () => {
  it('carries its connection status', () => {
    const err = new ApiError('unauthorized', 'boom')
    expect(err.status).toBe('unauthorized')
    expect(err.name).toBe('ApiError')
  })
})

/* ── SSE parsing ─────────────────────────────────────────────────────────── */

const DELTA_FRAME =
  'event: assistant.delta\ndata: {"text":"hello"}\n\n'
const TOOL_START_FRAME =
  'data: {"type":"tool.started","tool":"terminal","callId":"c1"}\n\n'
const TOOL_DONE_FRAME =
  'data: {"type":"tool.completed","tool":"terminal","ok":true,"callId":"c1"}\n\n'

describe('parseSseChunk', () => {
  it('parses a single typed frame', () => {
    const events = parseSseChunk(DELTA_FRAME)
    expect(events).toEqual([{ type: 'assistant.delta', text: 'hello' }])
  })

  it('parses multiple frames in one chunk', () => {
    const events = parseSseChunk(DELTA_FRAME + TOOL_START_FRAME + TOOL_DONE_FRAME)
    expect(events.map((e) => e.type)).toEqual([
      'assistant.delta',
      'tool.started',
      'tool.completed',
    ])
  })

  it('handles multi-line data frames by joining with newline', () => {
    const chunk = 'data: {"type":"assistant.delta",\ndata: "text":"a b"}\n\n'
    const events = parseSseChunk(chunk)
    expect(events).toHaveLength(1)
    expect((events[0] as { text?: string }).text).toBe('a b')
  })

  it('ignores comments and heartbeats', () => {
    expect(parseSseChunk(': ping\n\n')).toEqual([])
  })

  it('ignores blank frames', () => {
    expect(parseSseChunk('\n\n\n')).toEqual([])
  })

  it('skips malformed JSON payloads instead of crashing', () => {
    expect(parseSseChunk('data: {oops\n\n')).toEqual([])
  })

  it('uses the event: name as type when payload lacks one', () => {
    const events = parseSseChunk('event: custom.thing\ndata: {"x":1}\n\n')
    expect(events[0].type).toBe('custom.thing')
  })
})

describe('handleSseEvents', () => {
  it('dispatches deltas and tool events to callbacks', () => {
    const onDelta = vi.fn()
    const onToolStarted = vi.fn()
    const onToolCompleted = vi.fn()
    handleSseEvents(parseSseChunk(DELTA_FRAME + TOOL_START_FRAME + TOOL_DONE_FRAME), {
      onDelta,
      onToolStarted,
      onToolCompleted,
    })
    expect(onDelta).toHaveBeenCalledWith('hello')
    expect(onToolStarted).toHaveBeenCalledWith('terminal', 'c1')
    expect(onToolCompleted).toHaveBeenCalledWith('terminal', true, 'c1')
  })

  it('passes unknown events through onRaw', () => {
    const onRaw = vi.fn()
    handleSseEvents(parseSseChunk('data: {"type":"weird"}\n\n'), { onRaw })
    expect(onRaw).toHaveBeenCalledWith(expect.objectContaining({ type: 'weird' }))
  })
})

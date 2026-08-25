import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  apiFetch,
  buildRequest,
  GATEWAY_BASE,
  handleSseEvents,
  parseSseChunk,
} from '#/lib/api-client'
import {
  AuthFailedError,
  NetworkOrCorsError,
  NoApiKeyError,
  ServerError,
} from '#/lib/errors'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('buildRequest', () => {
  it('builds the gateway URL and attaches the Bearer auth header', () => {
    const req = buildRequest('/v1/models', { apiKey: 'sk-test-123' })
    expect(req.url).toBe(`${GATEWAY_BASE}/v1/models`)
    expect(req.headers.Authorization).toBe('Bearer sk-test-123')
    expect(req.method).toBe('GET')
  })

  it('defaults to GET with no auth header when no key given', () => {
    const req = buildRequest('/api/sessions')
    expect(req.method).toBe('GET')
    expect(req.headers.Authorization).toBeUndefined()
  })

  it('adds content-type json when a body is present', () => {
    const req = buildRequest('/v1/runs', {
      apiKey: 'k',
      method: 'POST',
      body: { prompt: 'hi' },
    })
    expect(req.method).toBe('POST')
    expect(req.headers['content-type']).toBe('application/json')
  })
})

describe('apiFetch — happy path', () => {
  it('sends the auth header and returns parsed JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, data: [1, 2] }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await apiFetch<{ ok: boolean }>('/v1/models', { apiKey: 'sk-a' })
    expect(result).toEqual({ ok: true, data: [1, 2] })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${GATEWAY_BASE}/v1/models`)
    expect(init.headers.Authorization).toBe('Bearer sk-a')
  })

  it('serializes a JSON body on POST', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'r1' }))
    vi.stubGlobal('fetch', fetchMock)

    await apiFetch('/v1/runs', { apiKey: 'sk-a', method: 'POST', body: { prompt: 'go' } })
    const [, init] = fetchMock.mock.calls[0]
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({ prompt: 'go' }))
  })
})

describe('apiFetch — error handling', () => {
  it('throws NoApiKeyError when no key is configured', async () => {
    await expect(apiFetch('/v1/models')).rejects.toBeInstanceOf(NoApiKeyError)
  })

  it('maps network failure to NetworkOrCorsError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(apiFetch('/v1/models', { apiKey: 'sk-a' })).rejects.toBeInstanceOf(
      NetworkOrCorsError,
    )
  })

  it('maps 401 to AuthFailedError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 401)))
    await expect(apiFetch('/v1/models', { apiKey: 'sk-bad' })).rejects.toBeInstanceOf(
      AuthFailedError,
    )
  })

  it('maps 403 to AuthFailedError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 403)))
    await expect(apiFetch('/v1/models', { apiKey: 'sk-bad' })).rejects.toBeInstanceOf(
      AuthFailedError,
    )
  })

  it('maps 5xx to ServerError carrying the status code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 502)))
    const err = (await apiFetch('/v1/models', {
      apiKey: 'sk-a',
    }).catch((e: ServerError) => e)) as ServerError
    expect(err).toBeInstanceOf(ServerError)
    expect(err.status).toBe(502)
  })

  it('throws a descriptive error for other unexpected statuses (429)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: 'slow down' }, 429)),
    )
    await expect(apiFetch('/v1/models', { apiKey: 'sk-a' })).rejects.toThrow(
      /Unexpected status 429: slow down/,
    )
  })

  it('throws on malformed JSON in an otherwise-successful response', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response('<html>not json</html>', { status: 200 })),
    )
    await expect(apiFetch('/v1/models', { apiKey: 'sk-a' })).rejects.toThrow(
      /Malformed JSON/,
    )
  })
})

/* ── SSE parsing ─────────────────────────────────────────────────────────── */

describe('parseSseChunk', () => {
  it('parses assistant.delta events', () => {
    const chunk = 'data: {"type":"assistant.delta","text":"Hello"}\n\n'
    expect(parseSseChunk(chunk)).toEqual([
      { type: 'assistant.delta', text: 'Hello' },
    ])
  })

  it('parses tool.started events', () => {
    const chunk =
      'data: {"type":"tool.started","tool":"web_search","callId":"c1"}\n\n'
    expect(parseSseChunk(chunk)).toEqual([
      { type: 'tool.started', tool: 'web_search', callId: 'c1' },
    ])
  })

  it('parses tool.completed events', () => {
    const chunk =
      'data: {"type":"tool.completed","tool":"web_search","ok":true,"callId":"c1"}\n\n'
    expect(parseSseChunk(chunk)).toEqual([
      { type: 'tool.completed', tool: 'web_search', ok: true, callId: 'c1' },
    ])
  })

  it('uses the event: field as type when payload omits it', () => {
    const chunk = 'event: assistant.delta\ndata: {"text":"hey"}\n\n'
    expect(parseSseChunk(chunk)).toEqual([{ text: 'hey', type: 'assistant.delta' }])
  })

  it('handles multiple frames and multi-line data in one chunk', () => {
    const chunk = [
      'data: {"type":"assistant.delta","text":"a"}',
      '',
      'data: {"type":"tool.started","tool":"shell"}',
      '',
      '',
    ].join('\n')
    const events = parseSseChunk(chunk)
    expect(events).toHaveLength(2)
    expect(events[0].type).toBe('assistant.delta')
    expect(events[1].type).toBe('tool.started')
  })

  it('ignores comments/heartbeats, blank frames and malformed JSON lines', () => {
    const chunk = [
      ': ping',
      '',
      'data: not-json-at-all',
      '',
      'data: {"type":"assistant.delta","text":"still alive"}',
      '',
    ].join('\n')
    expect(parseSseChunk(chunk)).toEqual([
      { type: 'assistant.delta', text: 'still alive' },
    ])
  })
})

describe('handleSseEvents', () => {
  it('routes each typed event to its handler', () => {
    const onDelta = vi.fn()
    const onToolStarted = vi.fn()
    const onToolCompleted = vi.fn()
    handleSseEvents(
      parseSseChunk(
        'data: {"type":"assistant.delta","text":"Hi"}\n\n' +
          'data: {"type":"tool.started","tool":"shell","callId":"t9"}\n\n' +
          'data: {"type":"tool.completed","tool":"shell","ok":false,"callId":"t9"}\n\n',
      ),
      { onDelta, onToolStarted, onToolCompleted },
    )
    expect(onDelta).toHaveBeenCalledWith('Hi')
    expect(onToolStarted).toHaveBeenCalledWith('shell', 't9')
    expect(onToolCompleted).toHaveBeenCalledWith('shell', false, 't9')
  })

  it('passes unknown event types through onRaw only', () => {
    const onRaw = vi.fn()
    handleSseEvents(parseSseChunk('data: {"type":"run.finished"}\n\n'), { onRaw })
    expect(onRaw).toHaveBeenCalledWith({ type: 'run.finished' })
  })
})

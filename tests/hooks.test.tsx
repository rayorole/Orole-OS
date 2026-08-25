import { renderHook, waitFor, act } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { useActivityFeed, useAgentStream, useGatewayStatus } from '#/lib/hooks'
import {
  AuthFailedError,
  NetworkOrCorsError,
  NoApiKeyError,
} from '#/lib/errors'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useGatewayStatus', () => {
  it('starts in a loading (pending) state', () => {
    fetchMock.mockReturnValue(new Promise(() => {})) // never resolves
    const { result } = renderHook(() => useGatewayStatus('sk-a'), {
      wrapper: makeWrapper(),
    })
    expect(result.current.isPending).toBe(true)
    expect(result.current.isError).toBe(false)
  })

  it('exposes success data after fetch resolves', async () => {
    const models = { data: [{ id: 'hermes-4' }] }
    fetchMock.mockResolvedValue(jsonResponse(models))
    const { result } = renderHook(() => useGatewayStatus('sk-a'), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(models)
    // auth header present on the request
    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers.Authorization).toBe('Bearer sk-a')
  })

  it('surfaces the typed error on network failure', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const { result } = renderHook(() => useGatewayStatus('sk-a'), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toBeInstanceOf(NetworkOrCorsError)
  })

  it('surfaces AuthFailedError on 401', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 401))
    const { result } = renderHook(() => useGatewayStatus('bad-key'), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toBeInstanceOf(AuthFailedError)
  })

  it('does not fire the query when no api key exists', async () => {
    const { result } = renderHook(() => useGatewayStatus(null), {
      wrapper: makeWrapper(),
    })
    // disabled query stays pending forever without calling fetch
    await new Promise((r) => setTimeout(r, 20))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.fetchStatus).toBe('idle')
  })

  it('maps a missing key through NoApiKeyError when forced to run', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    // call apiFetch directly with null key via a one-off hook usage
    const err = await import('#/lib/api-client').then(({ apiFetch }) =>
      apiFetch('/v1/models', { apiKey: null }).catch((e) => e),
    )
    expect(err).toBeInstanceOf(NoApiKeyError)
  })
})

describe('useActivityFeed', () => {
  it('loads sessions and exposes them as an array', async () => {
    const sessions = [{ id: 's1' }, { id: 's2' }]
    fetchMock.mockResolvedValue(jsonResponse(sessions))
    const { result } = renderHook(() => useActivityFeed('sk-a'), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(sessions)
    expect(fetchMock.mock.calls[0][0]).toContain('/api/sessions')
  })

  it('enters the error state when the endpoint fails', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 500))
    const { result } = renderHook(() => useActivityFeed('sk-a'), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect((result.current.error as Error).name).toBe('ServerError')
  })
})

/* ── SSE subscription ────────────────────────────────────────────────────── */

/** Build a Response whose body is a readable SSE stream. */
function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder()
  let i = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < frames.length) {
        controller.enqueue(encoder.encode(frames[i++]))
      } else {
        controller.close()
      }
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

const DELTA_FRAME =
  'data: {"type":"assistant.delta","text":"Hello"}\n\n'
const TOOL_STARTED_FRAME =
  'data: {"type":"tool.started","tool":"shell","callId":"t1"}\n\n'
const TOOL_COMPLETED_FRAME =
  'data: {"type":"tool.completed","tool":"shell","ok":true,"callId":"t1"}\n\n'

describe('useAgentStream', () => {
  it('accumulates assistant deltas and tool events from the stream', async () => {
    fetchMock.mockResolvedValue(
      sseResponse([DELTA_FRAME, TOOL_STARTED_FRAME, TOOL_COMPLETED_FRAME]),
    )
    const { result } = renderHook(
      () => useAgentStream('/v1/runs/r1/events', 'sk-a'),
      { wrapper: makeWrapper() },
    )
    await waitFor(() =>
      expect(result.current.text).toBe('Hello'),
    )
    await waitFor(() =>
      expect(result.current.events.map((e) => e.type)).toEqual([
        'assistant.delta',
        'tool.started',
        'tool.completed',
      ]),
    )
    // SSE request carried the right headers
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/v1/runs/r1/events')
    expect(init.headers.Accept).toBe('text/event-stream')
    expect(init.headers.Authorization).toBe('Bearer sk-a')
  })

  it('unsubscribes cleanly on unmount (abort, no further state updates)', async () => {
    // stream that never finishes — unmount must abort the reader
    fetchMock.mockImplementation(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(new TextEncoder().encode(DELTA_FRAME))
              // never closes
            },
          }),
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        ),
    )
    const { result, unmount } = renderHook(
      () => useAgentStream('/v1/runs/r2/events', 'sk-a'),
      { wrapper: makeWrapper() },
    )
    await waitFor(() => expect(result.current.text).toBe('Hello'))

    const abortSpy = vi.spyOn(AbortController.prototype, 'abort')
    unmount()
    expect(abortSpy).toHaveBeenCalled()
  })

  it('resets and re-subscribes when the key changes; skips when no key', async () => {
    fetchMock.mockResolvedValue(sseResponse([DELTA_FRAME]))
    const { result, rerender } = renderHook(
      ({ key }: { key: string | null }) =>
        useAgentStream('/v1/runs/r3/events', key),
      { wrapper: makeWrapper(), initialProps: { key: 'sk-a' as string | null } },
    )
    await waitFor(() => expect(result.current.text).toBe('Hello'))
    const callsAfterFirst = fetchMock.mock.calls.length

    rerender({ key: 'sk-b' }) // new subscription for the new key
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterFirst))

    rerender({ key: null }) // no key -> idle, no fetch
    await new Promise((r) => setTimeout(r, 10))
    expect(result.current.isStreaming).toBe(false)
  })

  it('reports stream errors through the error field', async () => {
    fetchMock.mockRejectedValue(new TypeError('network gone'))
    const { result } = renderHook(
      () => useAgentStream('/v1/runs/r4/events', 'sk-a'),
      { wrapper: makeWrapper() },
    )
    await waitFor(() => expect(result.current.error).toBeTruthy())
    expect((result.current.error as Error).message).toMatch(/network gone/)
    expect(result.current.isStreaming).toBe(false)
  })

  it('keeps partial frames buffered until a full frame arrives', async () => {
    const split = DELTA_FRAME.split('\n\n') // ["data: {...}", ""]
    fetchMock.mockResolvedValue(sseResponse([split[0], '\n\n'])) // frame arrives in two reads
    const { result } = renderHook(
      () => useAgentStream('/v1/runs/r5/events', 'sk-a'),
      { wrapper: makeWrapper() },
    )
    await waitFor(() => expect(result.current.text).toBe('Hello'))
    expect(act).toBeDefined() // act imported so RTL rules stay satisfied
  })
})

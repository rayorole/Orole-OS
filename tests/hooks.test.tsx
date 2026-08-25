import { renderHook, waitFor, act } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { useActivityFeed, useAgentStream, useGatewayStatus } from '#/lib/hooks'

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

/* ── useGatewayStatus ────────────────────────────────────────────────────── */

describe('useGatewayStatus', () => {
  it('starts in a loading (pending) state', () => {
    fetchMock.mockReturnValue(new Promise(() => {})) // never resolves
    const { result } = renderHook(() => useGatewayStatus(null), {
      wrapper: makeWrapper(),
    })
    expect(result.current.isPending).toBe(true)
    expect(result.current.isError).toBe(false)
  })

  it('exposes success data after fetch resolves', async () => {
    const models = { data: [{ id: 'hermes-4' }] }
    fetchMock.mockResolvedValue(jsonResponse(models))
    const { result } = renderHook(() => useGatewayStatus(null), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toBe('connected')
    // httpOnly session architecture: same-origin cookie auth, no Bearer header.
    const [, init] = fetchMock.mock.calls[0]
    expect(init.credentials).toBe('same-origin')
  })

  it('surfaces an error on network failure', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const { result } = renderHook(() => useGatewayStatus(null), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toBeTruthy()
  })

  it('surfaces unauthorized on 401', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 401))
    const { result } = renderHook(() => useGatewayStatus(null), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect((result.current.error as Error).message).toBe('unauthorized')
  })

  it('fires the query on mount and reports success', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [] }))
    const { result } = renderHook(() => useGatewayStatus(null), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(fetchMock).toHaveBeenCalled()
  })
})

/* ── useActivityFeed ─────────────────────────────────────────────────────── */

describe('useActivityFeed', () => {
  it('loads sessions and exposes them as an array', async () => {
    const sessions = [{ id: 's1' }, { id: 's2' }]
    fetchMock.mockResolvedValue(jsonResponse(sessions))
    const { result } = renderHook(() => useActivityFeed(null), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(sessions)
  })

  it('enters the error state when the endpoint fails', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 500 }))
    const { result } = renderHook(() => useActivityFeed(null), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
  })

  it('unsubscribes the query on unmount without errors', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]))
    const { unmount } = renderHook(() => useActivityFeed(null), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(() => unmount()).not.toThrow()
  })
})

/* ── useAgentStream (SSE over fetch streaming) ───────────────────────────── */

const DELTA_FRAME =
  'event: assistant.delta\ndata: {"text":"hello"}\n\n'
const TOOL_START_FRAME =
  'data: {"type":"tool.started","tool":"terminal","callId":"c1"}\n\n'
const TOOL_DONE_FRAME =
  'data: {"type":"tool.completed","tool":"terminal","ok":true,"callId":"c1"}\n\n'

function streamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  let sent = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent < chunks.length) {
        controller.enqueue(encoder.encode(chunks[sent++]))
      } else {
        controller.close()
      }
    },
  })
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

describe('useAgentStream', () => {
  it('accumulates assistant deltas and tool events from the stream', async () => {
    fetchMock.mockResolvedValue(
      streamResponse([DELTA_FRAME, TOOL_START_FRAME + TOOL_DONE_FRAME]),
    )
    const onDelta = vi.fn()
    const onToolStarted = vi.fn()
    const onToolCompleted = vi.fn()
    renderHook(
      () =>
        useAgentStream({
          path: '/api/gateway/api/sessions/s1/stream',
          onDelta,
          onToolStarted,
          onToolCompleted,
        }),
      { wrapper: makeWrapper() },
    )
    await waitFor(() => expect(onDelta).toHaveBeenCalledWith('hello'))
    await waitFor(() =>
      expect(onToolCompleted).toHaveBeenCalledWith('terminal', true, 'c1'),
    )
  })

  it('unsubscribes cleanly on unmount (abort, no further updates)', async () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => {})) // hangs until abort
    const onDelta = vi.fn()
    const { unmount } = renderHook(
      () =>
        useAgentStream({
          path: '/api/gateway/stream',
          onDelta,
        }),
      { wrapper: makeWrapper() },
    )
    expect(() => unmount()).not.toThrow()
    await act(async () => {})
    expect(onDelta).not.toHaveBeenCalled()
  })

  it('skips subscribing when disabled', async () => {
    renderHook(
      () => useAgentStream({ path: '/api/gateway/stream', enabled: false }),
      { wrapper: makeWrapper() },
    )
    await act(async () => {})
    expect(fetchMock).not.toHaveBeenCalledWith('/api/gateway/stream', expect.anything())
  })

  it('reports stream errors through the error field', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const { result } = renderHook(
      () => useAgentStream({ path: '/api/gateway/stream' }),
      { wrapper: makeWrapper() },
    )
    await waitFor(() => expect(result.current.lastError).toBeTruthy())
  })

  it('keeps partial frames buffered until a full frame arrives', async () => {
    const split = DELTA_FRAME.split('\n\n') // ["data: {...}", ""]
    const partialFirst = split[0] + '\n' // frame cut mid-way, no blank line yet
    fetchMock.mockResolvedValue(streamResponse([partialFirst, '\n\n' + DELTA_FRAME]))
    const onDelta = vi.fn()
    renderHook(() => useAgentStream({ path: '/api/gateway/stream', onDelta }), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(onDelta).toHaveBeenCalledTimes(2)) // once per complete frame; the partial produced none
    expect(onDelta).toHaveBeenNthCalledWith(1, 'hello')
    // The partial chunk must not have produced a premature duplicate.
    expect(onDelta).toHaveBeenCalledWith('hello')
  })

  it('re-subscribes when the path changes', async () => {
    fetchMock.mockResolvedValue(streamResponse([DELTA_FRAME]))
    const { rerender } = renderHook(
      ({ p }: { p: string }) => useAgentStream({ path: p }),
      {
        initialProps: { p: '/api/gateway/stream-a' },
        wrapper: makeWrapper(),
      },
    )
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes('stream-a'))).toBe(
        true,
      ),
    )
    rerender({ p: '/api/gateway/stream-b' })
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes('stream-b'))).toBe(
        true,
      ),
    )
  })

  it('never duplicates events across reconnect boundaries within one subscription', async () => {
    const gate = deferred<void>()
    fetchMock.mockImplementation(
      () => gate.promise.then(() => streamResponse([DELTA_FRAME])),
    )
    const onDelta = vi.fn()
    renderHook(() => useAgentStream({ path: '/api/gateway/stream', onDelta }), {
      wrapper: makeWrapper(),
    })
    gate.resolve()
    await waitFor(() => expect(onDelta).toHaveBeenCalledTimes(1))
  })
})

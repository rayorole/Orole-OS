import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

import {
  AlreadyDecidedError,
  foldActivityEvent,
  submitApproval,
} from '#/lib/approvals'
import { useApprovals } from '#/lib/use-approvals'
import { FakeEventSource } from './setup'

// ---------------------------------------------------------------------------
// foldActivityEvent (pure reducer)
// ---------------------------------------------------------------------------
describe('foldActivityEvent', () => {

  const base = {

    run_1: { runId: 'run_1', command: 'rm -rf /tmp/cache', requestedAt: 1000 },

  }



  it('inserts a card from an approval.request event', () => {

    const next = foldActivityEvent({}, 'approval.request', {

      run_id: 'run_9',

      command: 'git push --force',

      description: 'push',

      timestamp: 42.5,

      agent: 'coder',

      choices: ['once', 'deny'],

    })

    expect(next['run_9']).toMatchObject({

      runId: 'run_9',

      command: 'git push --force',

      description: 'push',

      agent: 'coder',

      requestedAt: 42500,

      choices: ['once', 'deny'],

    })

  })



  it('removes a tracked run on terminal lifecycle events', () => {

    for (const ev of ['run.completed', 'run.failed', 'run.cancelled', 'approval.responded']) {

      expect(foldActivityEvent(base, ev, { run_id: 'run_1' })['run_1']).toBeUndefined()

    }

  })



  it('ignores tool events for tracked runs and untracked/malformed frames', () => {

    expect(foldActivityEvent(base, 'tool.completed', { run_id: 'run_1' })['run_1']).toBeDefined()

    expect(foldActivityEvent(base, 'run.completed', { run_id: 'nope' })).toEqual(base)

    expect(foldActivityEvent(base, 'approval.request', {})).toEqual(base)

    expect(foldActivityEvent({}, 'approval.request', { command: 'no id' })).toEqual({})

  })

})



// ---------------------------------------------------------------------------

// submitApproval

// ---------------------------------------------------------------------------



describe('submitApproval', () => {

  afterEach(() => vi.unstubAllGlobals())



  function stubFetch(status: number, body: unknown) {

    const fn = vi.fn().mockImplementation(() =>

      Promise.resolve(

        new Response(JSON.stringify(body), {

          status,

          headers: { 'Content-Type': 'application/json' },

        }),

      ),

    )

    vi.stubGlobal('fetch', fn)

    return fn

  }



  it('posts choice + optional trimmed reason', async () => {

    const fetchMock = stubFetch(200, {

      object: 'hermes.run.approval_response',

      run_id: 'r1',

      choice: 'once',

      resolved: 1,

    })

    await submitApproval('r1', 'once')

    const [url, init] = fetchMock.mock.calls[0]

    expect(String(url)).toContain('/v1/runs/r1/approval')

    expect(init.method).toBe('POST')

    expect(JSON.parse(init.body)).toEqual({ choice: 'once' })



    await submitApproval('r1', 'deny', { reason: '  too risky  ' })

    expect(fetchMock.mock.calls[1][1].body).toBe(JSON.stringify({ choice: 'deny', reason: 'too risky' }))

  })



  it('throws AlreadyDecidedError on 409/404', async () => {

    stubFetch(409, { error: { code: 'approval_not_pending' } })

    await expect(submitApproval('r1', 'once')).rejects.toBeInstanceOf(AlreadyDecidedError)

    stubFetch(404, { error: { code: 'run_not_found' } })

    await expect(submitApproval('r1', 'deny')).rejects.toBeInstanceOf(AlreadyDecidedError)

  })



  it('surfaces network failures and HTTP errors as generic errors', async () => {

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    await expect(submitApproval('r1', 'once')).rejects.toThrow(/Could not reach/)



    stubFetch(500, { error: { message: 'boom' } })

    await expect(submitApproval('r1', 'once')).rejects.toThrow(/HTTP 500.*boom/s)

  })

})



// ---------------------------------------------------------------------------

// useApprovals hook — SSE-driven inbox + optimistic decide/revert

// ---------------------------------------------------------------------------



describe('useApprovals', () => {

  let fetchMock: ReturnType<typeof vi.fn>



  beforeEach(() => {

    FakeEventSource.reset()

    fetchMock = vi.fn()

    vi.stubGlobal('fetch', fetchMock)

  })

  afterEach(() => vi.unstubAllGlobals())



  function liveStream(): FakeEventSource {

    const es = FakeEventSource.latest as FakeEventSource | undefined

    if (!es) throw new Error('no EventSource created')

    es.open()

    return es

  }



  it('inserts and removes cards from the activity stream; badge count follows', async () => {

    const { result } = renderHook(() => useApprovals())

    const es = liveStream()



    act(() => {

      es.emit('approval.request', {

        run_id: 'r1',

        command: 'deploy prod',

        description: 'ship it',

        timestamp: 100,

        agent: 'ops-agent',

      })

      es.emit('approval.request', { run_id: 'r2', command: 'kubectl drain node-3', timestamp: 200 })

    })

    await waitFor(() => expect(result.current.count).toBe(2))

    expect(result.current.status).toBe('live')

    expect(result.current.approvals[0].runId).toBe('r1') // sorted by requestedAt



    act(() => {

      es.emit('run.completed', { run_id: 'r2' })

    })

    await waitFor(() => expect(result.current.count).toBe(1))

  })



  it('decide() removes the card optimistically on success', async () => {

    fetchMock.mockResolvedValue(

      new Response(JSON.stringify({ object: 'hermes.run.approval_response', run_id: 'r1', choice: 'once', resolved: 1 }), { status: 200 }),

    )

    const { result } = renderHook(() => useApprovals())

    const es = liveStream()

    act(() => es.emit('approval.request', { run_id: 'r1', command: 'do thing', timestamp: 5 }))

    await waitFor(() => expect(result.current.count).toBe(1))



    let ok = false

    await act(async () => {

      ok = await result.current.decide('r1', 'once')

    })

    expect(ok).toBe(true)

    await waitFor(() => expect(result.current.count).toBe(0))

    expect(fetchMock.mock.calls[0][0]).toContain('/v1/runs/r1/approval')

  })



  it('reverts the optimistic removal when the POST fails recoverably', async () => {

    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    const { result } = renderHook(() => useApprovals())

    const es = liveStream()

    act(() => es.emit('approval.request', { run_id: 'r1', command: 'risky cmd', timestamp: 7 }))

    await waitFor(() => expect(result.current.count).toBe(1))



    let ok: boolean | undefined

    await act(async () => {

      ok = await result.current.decide('r1', 'deny')

    })

    expect(ok).toBe(false)

    // card restored with its original payload

    await waitFor(() => expect(result.current.count).toBe(1))

    expect(result.current.approvals[0].command).toBe('risky cmd')

    expect(result.current.lastError).toMatch(/Could not reach/)

  })



  it('reverts and surfaces HTTP errors (5xx) with retryable card', async () => {

    fetchMock.mockResolvedValue(

      new Response(JSON.stringify({ error: { message: 'boom' } }), { status: 500 }),

    )

    const { result } = renderHook(() => useApprovals())

    const es = liveStream()

    act(() => es.emit('approval.request', { run_id: 'r1', command: 'cmd', timestamp: 7 }))

    await waitFor(() => expect(result.current.count).toBe(1))



    let ok = false

    await act(async () => {

      ok = await result.current.decide('r1', 'once')

    })

    expect(ok).toBe(false)

    await waitFor(() => {

      expect(result.current.count).toBe(1)

      expect(result.current.lastError).toMatch(/HTTP 500/)

    })

  })



  it('treats 409 already-decided as success: card stays removed, no revert, note surfaced', async () => {

    fetchMock.mockResolvedValue(

      new Response(JSON.stringify({ error: { code: 'approval_not_pending' } }), { status: 409 }),

    )

    const { result } = renderHook(() => useApprovals())

    const es = liveStream()

    act(() => es.emit('approval.request', { run_id: 'r1', command: 'x', timestamp: 9 }))

    await waitFor(() => expect(result.current.count).toBe(1))



    let ok = false

    await act(async () => {

      ok = await result.current.decide('r1', 'once')

    })

    expect(ok).toBe(true)

    await waitFor(() => {

      expect(result.current.count).toBe(0)

      expect(result.current.decidedNote).toMatch(/already decided/i)

    })

    expect(result.current.lastError).toBeNull()

  })



  it('marks reconnecting after a stream drop and recovers', async () => {

    const { result } = renderHook(() => useApprovals())

    const first = liveStream()

    first.fail()

    await waitFor(() => expect(result.current.status).toBe('reconnecting'))



    await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThanOrEqual(2))

    FakeEventSource.latest!.open()

    await waitFor(() => expect(result.current.status).toBe('live'))

    expect(first.closed).toBe(true)

  })



  it('passes deny reason through to the endpoint body', async () => {

    fetchMock.mockResolvedValue(

      new Response(JSON.stringify({ object: 'hermes.run.approval_response', run_id: 'r1', choice: 'deny', resolved: 1 }), { status: 200 }),

    )

    const { result } = renderHook(() => useApprovals())

    const es = liveStream()

    act(() => es.emit('approval.request', { run_id: 'r1', command: 'x', timestamp: 1 }))

    await waitFor(() => expect(result.current.count).toBe(1))



    await act(async () => {

      await result.current.decide('r1', 'deny', 'not today')

    })

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({

      choice: 'deny',

      reason: 'not today',

    })

  })

})
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RunControlError, cancelRun, pauseRun } from '#/lib/run-control'

const base = 'https://os.orole.be'

function mockFetch(status: number, body: unknown = {}) {
  const fn = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('run control endpoints', () => {
  it('cancelRun POSTs to /v1/runs/{id}/cancel', async () => {
    const f = mockFetch(200)
    await cancelRun('run-42')
    expect(f).toHaveBeenCalledWith(
      `${base}/v1/runs/run-42/cancel`,
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('pauseRun POSTs to /v1/runs/{id}/pause with URL encoding', async () => {
    const f = mockFetch(200)
    await pauseRun('a/b')
    expect(f).toHaveBeenCalledWith(
      `${base}/v1/runs/a%2Fb/pause`,
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('surfaces HTTP errors as RunControlError with detail', async () => {
    mockFetch(409, { error: 'run already finished' })
    await expect(cancelRun('x')).rejects.toMatchObject({
      name: 'RunControlError',
      status: 409,
      message: expect.stringContaining('already finished'),
    } as Partial<RunControlError>)
  })

  it('maps network failures to a zero-status RunControlError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    const err = await cancelRun('x').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RunControlError)
    expect((err as RunControlError).status).toBe(0)
  })
})

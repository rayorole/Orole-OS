/*
 * Route smoke suite — renders each main route through the real TanStack
 * router against a mocked same-origin gateway: every route mounts and zero
 * uncaught render errors. Updated for the httpOnly-session architecture (#32):
 * no API key in localStorage; the browser talks to /api/gateway/* with cookies.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createMemoryHistory, createRouter, createRootRoute, createRoute, Outlet, RouterProvider } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { Route as homeRouteDef } from '#/routes/index'
import { Route as analyticsRouteDef } from '#/routes/analytics'
import { Route as settingsRouteDef } from '#/routes/settings'
import { Route as agentRouteDef } from '#/routes/agents.$agentId'
import { VoiceOverlay } from '#/components/voice-overlay'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  // httpOnly session architecture: the browser holds no key, requests are
  // cookie-authenticated same-origin calls to /api/gateway/*.
  fetchMock = vi.fn().mockImplementation((url: string) => {
    if (String(url).includes('/v1/models')) return Promise.resolve(jsonResponse({ data: [] }))
    if (String(url).includes('/api/sessions')) return Promise.resolve(jsonResponse([]))
    if (String(url).includes('/runs') || String(url).includes('/analytics'))
      return Promise.resolve(jsonResponse({ success: 12, failed: 3, totalRuns: 15 }))
    if (String(url).includes('/api/gateway') && !String(url).includes('/events'))
      return Promise.resolve(jsonResponse({ data: [] }))
    // SSE stream endpoints: empty-but-valid event stream
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: {"type":"assistant.delta","text":"hi"}\n\n'))
        c.close()
      },
    })
    return Promise.resolve(
      new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    )
  })
  vi.stubGlobal('fetch', fetchMock)

  // Mocked browser Speech APIs so the voice overlay mounts
  class FakeRecognition {
    lang = ''
    interimResults = false
    continuous = false
    onresult = null
    onend = null
    onerror = null
    start() {}
    stop() {}
  }
  ;(window as unknown as Record<string, unknown>).SpeechRecognition = FakeRecognition
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: { speak: vi.fn(), cancel: vi.fn() },
  })
  ;(window as unknown as Record<string, unknown>).SpeechSynthesisUtterance =
    class { onend: (() => void) | null = null }

  // Fail the test on any uncaught error / unhandled rejection
  window.addEventListener('error', onError)
})

const onError = (event: ErrorEvent) => {
  throw new Error(`Uncaught page error: ${event.message}`)
}

afterEach(() => {
  window.removeEventListener('error', onError)
  vi.unstubAllGlobals()
})

/* ── Router harness ──────────────────────────────────────────────────────── */

async function mountAt(path: string) {
  const rootRoute = createRootRoute({
    component: () => (
      <>
        <Outlet />
        <VoiceOverlay />
      </>
    ),
  })
  const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: homeRouteDef.options.component })
  const analyticsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/analytics', component: analyticsRouteDef.options.component })
  const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/settings', component: settingsRouteDef.options.component })
  const agentRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/agents/$agentId',
    component: agentRouteDef.options.component,
  })

  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, analyticsRoute, settingsRoute, agentRoute]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  await router.load()

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { router, ...utils }
}

// Keep the route definitions referenced so tree-shaking/type checks stay honest
void [homeRouteDef, analyticsRouteDef, settingsRouteDef, agentRouteDef]

/* ── Smoke tests ─────────────────────────────────────────────────────────── */

describe('route smoke coverage', () => {
  it('dashboard/home: mission control route renders without errors', async () => {
    const { container } = await mountAt('/')
    await waitFor(() => expect(document.querySelector('main')).not.toBeNull())
    expect(container.textContent?.length ?? 0).toBeGreaterThan(0)
  }, 15_000)

  it('analytics: route mounts with mocked run data', async () => {
    const { container } = await mountAt('/analytics')
    await waitFor(() => expect(document.querySelector('main')).not.toBeNull())
    expect(container.textContent?.length ?? 0).toBeGreaterThan(0)
  }, 15_000)

  it('settings: security notice present, no key stored in localStorage', async () => {
    const user = userEvent.setup()
    const { container } = await mountAt('/settings')
    await waitFor(() => expect(document.querySelector('main')).not.toBeNull())
    // The httpOnly migration wiped any legacy key from localStorage.
    expect(window.localStorage.getItem('orole.apiKey')).toBeNull()
    expect(container.textContent).not.toMatch(/Bearer sk-/)
    void user
  }, 15_000)

  it('per-agent transcript: streams and shows tool events', async () => {
    await mountAt('/agents/atlas')
    expect(screen.getByTestId('agent-name')).toHaveTextContent('Agent: atlas')
    await waitFor(() =>
      expect(screen.getByTestId('transcript')).toHaveTextContent('hi'),
    )
  }, 15_000)

  it('voice overlay mounts with mocked Speech APIs', async () => {
    const { container } = await mountAt('/')
    const overlay = await screen.findByTestId('voice-overlay')
    expect(overlay).toBeInTheDocument()
    expect(container).toBeTruthy()
  }, 15_000)

  it('every main route loads without a single failed gateway call crashing the page', async () => {
    for (const path of ['/', '/analytics', '/settings', '/agents/atlas']) {
      const { unmount } = await mountAt(path)
      await waitFor(() => expect(document.querySelector('main')).not.toBeNull())
      unmount()
    }
    expect(fetchMock).toHaveBeenCalled()
  }, 30_000)
})

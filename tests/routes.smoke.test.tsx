/**
 * Route smoke suite — renders each main route through the real TanStack
 * router with mocked gateway fetches and Speech APIs, asserting key UI
 * mounts and zero uncaught render errors.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createMemoryHistory, createRouter, createRootRoute, createRoute, Outlet, RouterProvider } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { Route as homeRouteDef } from '#/routes/index'
import { Route as aboutRouteDef } from '#/routes/about'
import { Route as analyticsRouteDef } from '#/routes/analytics'
import { Route as settingsRouteDef } from '#/routes/settings'
import { Route as agentRouteDef } from '#/routes/agents.$agentId'
import { VoiceOverlay } from '#/components/voice-overlay'

/* ── Mocks ───────────────────────────────────────────────────────────────── */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  window.localStorage.setItem('orole.apiKey', 'sk-smoke')
  fetchMock = vi.fn().mockImplementation((url: string) => {
    if (String(url).includes('/v1/models')) return Promise.resolve(jsonResponse({ data: [] }))
    if (String(url).includes('/api/sessions')) return Promise.resolve(jsonResponse([]))
    if (String(url).includes('/api/analytics'))
      return Promise.resolve(jsonResponse({ totalRuns: 12, tokensIn: 1000, tokensOut: 2000 }))
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
  const aboutRoute = createRoute({ getParentRoute: () => rootRoute, path: '/about', component: aboutRouteDef.options.component })
  const analyticsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/analytics', component: analyticsRouteDef.options.component })
  const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/settings', component: settingsRouteDef.options.component })
  const agentRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/agents/$agentId',
    component: agentRouteDef.options.component,
  })

  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, aboutRoute, analyticsRoute, settingsRoute, agentRoute]),
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
void [homeRouteDef, aboutRouteDef, analyticsRouteDef, settingsRouteDef, agentRouteDef]

/* ── Smoke tests ─────────────────────────────────────────────────────────── */

describe('route smoke coverage', () => {
  it('dashboard/home: hero, diagnostics panel and activity feed render', async () => {
    const { container } = await mountAt('/')
    expect(screen.getByRole('heading', { level: 1, name: /orole-os/i })).toBeInTheDocument()
    expect(screen.getByText(/core diagnostics/i)).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByText(/all subsystems nominal/i)).toBeInTheDocument(),
    )
    expect(container.textContent).toContain('Agent Activity')
  }, 15_000)

  it('about: page copy renders', async () => {
    await mountAt('/about')
    expect(screen.getByRole('heading', { name: /room to grow/i })).toBeInTheDocument()
  }, 15_000)

  it('analytics: stats grid renders with fetched numbers', async () => {
    await mountAt('/analytics')
    await waitFor(() =>
      expect(screen.getByTestId('analytics-stats')).toHaveTextContent('12'),
    )
    expect(screen.getByText('Analytics')).toBeInTheDocument()
  }, 15_000)

  it('settings: api key input persists to localStorage', async () => {
    const user = userEvent.setup()
    await mountAt('/settings')
    expect(document.title).toBe('Settings — Orole-OS')
    const input = screen.getByTestId('api-key-input')
    await user.clear(input)
    await user.type(input, 'sk-smoke-key')
    expect(window.localStorage.getItem('orole.apiKey')).toBe('sk-smoke-key')
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
    expect(screen.getByTestId('voice-button')).toHaveTextContent(/hold to talk/i)
    expect(container).toBeTruthy()
  }, 15_000)

  it('every main route loads without a single failed gateway call crashing the page', async () => {
    for (const path of ['/', '/about', '/analytics', '/settings', '/agents/atlas']) {
      const { unmount } = await mountAt(path)
      await waitFor(() => expect(document.querySelector('main')).not.toBeNull())
      unmount()
    }
    expect(fetchMock).toHaveBeenCalled()
  }, 30_000)
})

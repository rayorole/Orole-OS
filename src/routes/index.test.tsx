import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, cleanup } from '@testing-library/react'

// Importing the route module must not pull any demo scaffolding.
import { Route } from './index'

vi.mock('@tanstack/react-router', async () => {
  const actual =
    await vi.importActual<typeof import('@tanstack/react-router')>(
      '@tanstack/react-router',
    )
  return {
    ...actual,
    Link: ({
      children,
      ...props
    }: { children: React.ReactNode } & Record<string, unknown>) => (
      <a {...props}>{children}</a>
    ),
  }
})

function renderHome() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const Component = Route.options.component!
  return render(
    <QueryClientProvider client={client}>
      <Component />
    </QueryClientProvider>,
  )
}

describe('homepage /', () => {
  beforeAll(() => {
    // Offline gateway: queries settle into their error states.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    )
  })

  it('renders the mission-control hero', () => {
    const { getByText } = renderHome()
    expect(getByText(/mission control/i)).toBeInTheDocument()
    expect(getByText(/Orole/)).toBeInTheDocument()
  })

  it('renders a live gateway status strip instead of a diagnostics card', () => {
    const { getByTestId } = renderHome()
    expect(getByTestId('gateway-status-strip')).toBeInTheDocument()
  })

  afterEach(cleanup)

  it('never renders StateShowcase demo content', async () => {
    const { container } = renderHome()
    await vi.waitFor(() => {
      expect(container.textContent).not.toContain('signal clear')
      expect(container.textContent).not.toContain('Scanning')
    })
    expect(container.innerHTML).not.toMatch(/StateShowcase/i)
    expect(container.textContent).not.toContain('Core Diagnostics')
  })
})

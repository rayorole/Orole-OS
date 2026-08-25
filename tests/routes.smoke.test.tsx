import { describe, it, expect } from 'vitest'
import { createRouter, createRootRoute, createRoute, Outlet, RouterProvider } from '@tanstack/react-router'
import { render } from '@testing-library/react'

describe('smoke', () => {
  it('app mounts', () => {
    const rootRoute = createRootRoute({ component: () => <main><Outlet /></main> })
    const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => <div>mission control</div> })
    const routeTree = rootRoute.addChildren([indexRoute])
    const router = createRouter({ routeTree })
    render(<RouterProvider router={router} />)
    expect(document.querySelector('main')).not.toBeNull()
  })
})

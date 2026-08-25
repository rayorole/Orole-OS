import { HeadContent, Scripts, createRootRoute, Link } from '@tanstack/react-router'
import { AppProviders } from '../lib/query-provider'
import { ApprovalNavBadge } from '../lib/use-approvals'

import appCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'Orole-OS · Mission Control',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
    ],
  }),
  shellComponent: RootDocument,
})

const NAV = [
  { to: '/', label: 'Mission Control' },
] as const

const NAV_APPROVALS = { to: '/approvals', label: 'Approvals' } as const

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className="dark">
      <head>
        <HeadContent />
      </head>
      <body className="dark min-h-screen font-sans antialiased [overflow-wrap:anywhere] selection:bg-primary/20">
        <AppProviders>
          <div className="flex min-h-screen flex-col">
            <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-lg">
              <nav
                aria-label="Primary"
                className="hud-page flex items-center gap-6 py-3"
              >
                <Link
                  to="/"
                  className="flex items-center gap-2.5 no-underline"
                  activeOptions={{ exact: true }}
                >
                  <span className="relative inline-flex size-2.5 rounded-full bg-status-running shadow-[0_0_10px_var(--status-running-glow)] motion-safe:animate-pulse" />
                  <span className="font-mono text-sm font-semibold uppercase tracking-[0.3em] text-foreground">
                    Orole<span className="text-neon-cyan">·</span>OS
                  </span>
                </Link>
                <div className="flex items-center gap-4">
                  {NAV.map((item) => (
                    <Link
                      key={item.to}
                      to={item.to}
                      activeProps={{
                        className:
                          'font-mono text-xs uppercase tracking-[0.2em] text-neon-cyan no-underline',
                      }}
                      inactiveProps={{
                        className:
                          'font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground no-underline transition-colors hover:text-foreground',
                      }}
                    >
                      {item.label}
                    </Link>
                  ))}
                  <Link
                    to={NAV_APPROVALS.to}
                    activeProps={{
                      className:
                        'font-mono text-xs uppercase tracking-[0.2em] text-neon-cyan no-underline',
                    }}
                    inactiveProps={{
                      className:
                        'font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground no-underline transition-colors hover:text-foreground',
                    }}
                  >
                    {NAV_APPROVALS.label}
                    <ApprovalNavBadge />
                  </Link>
                </div>
              </nav>
            </header>

            <main className="flex flex-1 flex-col">{children}</main>

            <footer className="border-t border-border">
              <div className="hud-page flex items-center justify-between py-4">
                <p className="hud-panel-title m-0">
                  Orole-OS mission control
                </p>
                <p className="m-0 font-mono text-xs text-muted-foreground">
                  all systems nominal
                </p>
              </div>
            </footer>
          </div>
        </AppProviders>
        <Scripts />
      </body>
    </html>
  )
}

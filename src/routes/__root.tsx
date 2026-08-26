import { HeadContent, Scripts, createRootRoute, Link } from '@tanstack/react-router'
import { ChatModeProvider, useChatMode } from '../lib/chat-mode'
import { ChatModeToggle } from '../components/text-chat/ChatModeToggle'
import { TextChatPanel } from '../components/text-chat/TextChatPanel'
import { AppProviders } from '../lib/query-provider'
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuList,
  navigationMenuTriggerStyle,
} from '#/components/ui/navigation-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Separator } from '#/components/ui/separator'
import { Button } from '#/components/ui/button'
import { Toaster } from '#/components/ui/sonner'

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
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/puppet', label: 'Puppet View' },
  { to: '/analytics', label: 'Analytics' },
  { to: '/costs', label: 'Costs' },
  { to: '/approvals', label: 'Approvals' },
  { to: '/settings', label: 'Settings' },
] as const

const EXTERNAL_LINKS = [
  { href: 'https://github.com/rayorole/Orole-OS', label: 'GitHub' },
  { href: 'https://os.orole.be', label: 'Gateway' },
] as const

/** Renders the text chat overlay while in backup (text) mode. */
function TextModeGate({ children }: { children: React.ReactNode }) {
  const { mode } = useChatMode()
  return (
    <>
      {children}
      {mode === 'text' && <TextChatPanel />}
    </>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className="dark">
      <head>
        <HeadContent />
      </head>
      <body className="dark min-h-screen font-sans antialiased [overflow-wrap:anywhere] selection:bg-primary/20">
        <AppProviders>
          <ChatModeProvider>
            <div className="flex min-h-screen flex-col">
              <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-lg">
                <nav
                  aria-label="Primary"
                  className="hud-page flex items-center gap-4 py-3"
                >
                  <Link
                    to="/"
                    aria-label="Orole-OS home"
                    className="hud-corner-accent flex items-center gap-2.5 px-2 py-1 no-underline"
                    activeOptions={{ exact: true }}
                  >
                    <span className="relative inline-flex size-2.5 rounded-full bg-status-running shadow-[0_0_10px_var(--status-running-glow)] motion-safe:animate-pulse" />
                    <span className="font-mono text-sm font-semibold uppercase tracking-[0.3em] text-foreground">
                      Orole<span className="text-neon-cyan">·</span>OS
                    </span>
                  </Link>
                  <Separator orientation="vertical" className="hidden h-5 sm:block" />
                  <NavigationMenu className="max-w-none">
                    <NavigationMenuList className="gap-1">
                      {NAV.map((item) => (
                        <NavigationMenuItem key={item.to}>
                          <Link
                            to={item.to}
                            activeProps={{
                              className:
                                'font-mono text-xs uppercase tracking-[0.2em] text-neon-cyan no-underline outline-none focus-visible:text-neon-cyan',
                            }}
                            inactiveProps={{
                              className:
                                'font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground no-underline transition-colors hover:text-foreground focus-visible:text-foreground',
                            }}
                          >
                            {({ isActive }) => (
                              <span
                                className={
                                  navigationMenuTriggerStyle() +
                                  (isActive
                                    ? ' bg-transparent font-mono text-xs uppercase tracking-[0.2em] text-neon-cyan underline-offset-4 aria-expanded:bg-transparent'
                                    : ' bg-transparent font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground underline-offset-4 hover:text-foreground focus:text-foreground aria-expanded:bg-transparent')
                                }
                              >
                                {item.label}
                              </span>
                            )}
                          </Link>
                        </NavigationMenuItem>
                      ))}
                    </NavigationMenuList>
                  </NavigationMenu>

                  <div className="ml-auto">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label="More resources"
                          className="font-mono text-xs uppercase tracking-[0.2em]"
                        >
                          Resources ▾
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="hud-corner-accent">
                        <DropdownMenuLabel className="font-mono text-xs uppercase tracking-widest">
                          External
                        </DropdownMenuLabel>
                        {EXTERNAL_LINKS.map((link) => (
                          <DropdownMenuItem key={link.href} asChild>
                            <a
                              href={link.href}
                              target="_blank"
                              rel="noreferrer"
                              aria-label={`${link.label} (opens in a new tab)`}
                              className="font-mono text-xs uppercase tracking-wider"
                            >
                              {link.label}
                            </a>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </nav>
              </header>

              <main className="flex flex-1 flex-col">
                <TextModeGate>{children}</TextModeGate>
              </main>

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
            <ChatModeToggle className="fixed right-4 top-20 z-40" />
          </ChatModeProvider>
        </AppProviders>
        <Toaster position="bottom-right" />
        <Scripts />
      </body>
    </html>
  )
}

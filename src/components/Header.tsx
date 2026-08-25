import { Link } from '@tanstack/react-router'

import ConnectionIndicator from './ConnectionIndicator'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuList,
} from '#/components/ui/navigation-menu'
import { Separator } from '#/components/ui/separator'
import { Button } from '#/components/ui/button'

const NAV = [
  { to: '/', label: 'Home' },
  { to: '/transcript', label: 'Transcript' },
  { to: '/puppet', label: 'Puppet View' },
  { to: '/settings', label: 'Settings' },
] as const

const EXTERNAL_LINKS = [
  { href: 'https://x.com/tan_stack', label: 'Follow on X', srOnly: 'Follow TanStack on X' },
  { href: 'https://github.com/TanStack', label: 'GitHub', srOnly: 'Go to TanStack GitHub' },
  { href: 'https://tanstack.com/start/latest/docs/framework/react/overview', label: 'Docs', srOnly: 'TanStack Start docs' },
] as const

export default function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[var(--header-bg)] px-4 backdrop-blur-lg">
      <nav className="page-wrap flex flex-wrap items-center gap-x-3 gap-y-2 py-3 sm:py-4">
        <h2 className="m-0 flex-shrink-0 text-base font-semibold tracking-tight">
          <Link
            to="/"
            className="inline-flex items-center gap-2 rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-1.5 text-sm text-[var(--sea-ink)] no-underline shadow-[0_8px_24px_rgba(30,90,72,0.08)] sm:px-4 sm:py-2"
          >
            <span className="h-2 w-2 rounded-full bg-[linear-gradient(90deg,#56c6be,#7ed3bf)]" />
            TanStack Start
          </Link>
        </h2>

        <Separator orientation="vertical" className="hidden h-6 sm:block" />

        <NavigationMenu className="order-3 max-w-none sm:order-none">
          <NavigationMenuList className="gap-x-1">
            {NAV.map((item) => (
              <NavigationMenuItem key={item.to}>
                <Link
                  to={item.to}
                  activeProps={{ className: 'nav-link is-active' }}
                  inactiveProps={{ className: 'nav-link' }}
                >
                  {({ isActive }) => (
                    <span
                      className={`px-2 py-1 text-sm font-semibold ${isActive ? 'text-foreground' : 'text-[var(--sea-ink-soft)] hover:text-[var(--sea-ink)]'}`}
                    >
                      {item.label}
                    </span>
                  )}
                </Link>
              </NavigationMenuItem>
            ))}
          </NavigationMenuList>
        </NavigationMenu>

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <ConnectionIndicator />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                aria-label="External resources"
                className="hidden font-mono text-xs uppercase tracking-wider sm:inline-flex"
              >
                Links ▾
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>External</DropdownMenuLabel>
              {EXTERNAL_LINKS.map((link) => (
                <DropdownMenuItem key={link.href} asChild>
                  <a href={link.href} target="_blank" rel="noreferrer">
                    <span className="sr-only">{link.srOnly}</span>
                    {link.label}
                  </a>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <a href="https://tanstack.com" target="_blank" rel="noreferrer">
                  TanStack.com
                </a>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </nav>
    </header>
  )
}

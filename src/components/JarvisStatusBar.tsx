// Jarvis status bar (#25): ambient always-visible HUD line pinned to the
// bottom of every route. Segments are clickable, live-updating, stale-aware,
// and the whole bar is TTS-announcable via the Jarvis voice pipeline.

import { useEffect, useRef } from 'react'
import { Link } from '@tanstack/react-router'
import { Volume2, VolumeX } from 'lucide-react'

import {
  formatSpokenSummary,
  useFleetStatus,
} from '../hooks/useFleetStatus'
import { useJarvisAnnouncer } from '../hooks/useJarvisAnnouncer'
import { Badge } from '#/components/ui/badge'
import { Skeleton } from '#/components/ui/skeleton'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '#/components/ui/tooltip'

export function JarvisStatusBar() {
  const status = useFleetStatus()
  const { enabled, speaking, announce, toggle } = useJarvisAnnouncer()

  // Announce on significant change (never on every poll tick).
  const lastSpokenRef = useRef<string | null>(null)
  const firstValueRef = useRef(true)
  useEffect(() => {
    if (status.loading || status.stale) return
    const summary = formatSpokenSummary(status)
    if (firstValueRef.current) {
      firstValueRef.current = false
      lastSpokenRef.current = summary
      return
    }
    if (summary !== lastSpokenRef.current) {
      lastSpokenRef.current = summary
      void announce(summary)
    }
  }, [status, announce])

  const handleManualAnnounce = () => {
    void announce(formatSpokenSummary(status))
  }

  const segments: Array<{
    to: string
    label: string
    count: number
  }> = [
    { to: '/agents', label: 'agents active', count: status.activeAgents },
    { to: '/runs', label: 'tasks running', count: status.tasksRunning },
    { to: '/analytics', label: 'PRs open', count: status.prsOpen },
  ]

  return (
    <TooltipProvider>
      <footer
        role="status"
        aria-live="polite"
        aria-label="Fleet status"
        data-stale={status.stale || undefined}
        className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75"
      >
        <div className="mx-auto flex h-10 max-w-screen-2xl items-center gap-4 px-4">
          <span
            aria-hidden="true"
            className={
              status.loading
                ? 'size-2 shrink-0 rounded-full bg-muted-foreground'
                : status.stale
                  ? 'size-2 shrink-0 animate-pulse rounded-full bg-destructive shadow-[0_0_8px_var(--destructive)]'
                  : 'size-2 shrink-0 rounded-full bg-primary shadow-[0_0_8px_var(--neon-cyan)]'
            }
          />
          {status.loading ? (
            <div className="flex items-center gap-3">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-20" />
              <span className="sr-only">Loading fleet status</span>
            </div>
          ) : (
            <nav
              aria-label="Status segments"
              className="flex min-w-0 items-center gap-4 overflow-x-auto font-mono text-xs"
            >
              {segments.map((segment) => (
                <Link
                  key={segment.to}
                  to={segment.to}
                  className="group flex shrink-0 items-center gap-1.5 whitespace-nowrap text-muted-foreground transition-colors hover:text-primary focus-visible:text-primary"
                >
                  <Badge
                    variant="outline"
                    className="tabular-nums text-neon-cyan group-hover:text-primary group-focus-visible:text-primary"
                  >
                    {segment.count}
                  </Badge>
                  {segment.label}
                </Link>
              ))}
            </nav>
          )}
          {status.stale && (
            <Badge variant="destructive" className="ml-auto shrink-0 font-mono text-[10px] uppercase tracking-widest">
              stale · reconnecting
            </Badge>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={enabled ? handleManualAnnounce : toggle}
                onDoubleClick={toggle}
                aria-pressed={enabled}
                aria-label={
                  enabled
                    ? 'Mute Jarvis status announcements'
                    : speaking
                      ? 'Jarvis is announcing status'
                      : 'Enable Jarvis status announcements'
                }
                className="ml-auto flex size-7 shrink-0 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors hover:border-border hover:text-primary focus-visible:border-ring focus-visible:outline-none disabled:opacity-50"
                disabled={status.loading}
              >
                {enabled ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {enabled
                ? 'Announce now (double-click to mute)'
                : 'Enable Jarvis voice announcements'}
            </TooltipContent>
          </Tooltip>
        </div>
      </footer>
    </TooltipProvider>
  )
}

export default JarvisStatusBar

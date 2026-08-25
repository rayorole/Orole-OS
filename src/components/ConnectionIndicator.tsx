import { useEffect, useState } from 'react'

import { checkSession } from '#/lib/session-client'
import { Badge } from '#/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '#/components/ui/tooltip'

export type HeaderStatus = 'no-session' | 'unverified' | 'ok' | 'error'

const LABELS: Record<
  HeaderStatus,
  { text: string; variant: 'running' | 'pending' | 'failed' | 'idle'; title: string }
> = {
  'no-session': {
    text: 'signed out',
    variant: 'idle',
    title: 'No active session — open Settings to sign in.',
  },
  unverified: {
    text: 'session',
    variant: 'pending',
    title: 'Session active but not yet verified — test it in Settings.',
  },
  ok: {
    text: 'live',
    variant: 'running',
    title: 'Connected to the backend via secure session.',
  },
  error: {
    text: 'offline',
    variant: 'failed',
    title: 'Backend unreachable or session rejected — see Settings.',
  },
}

/**
 * Persistent at-a-glance connection indicator for the header.
 * Verifies the httpOnly session once per mount with a cheap authenticated call.
 */
export default function ConnectionIndicator() {
  const [status, setStatus] = useState<HeaderStatus>('no-session')

  useEffect(() => {
    let cancelled = false
    void checkSession().then((auth) => {
      if (cancelled) return
      if (auth !== 'authenticated') {
        setStatus('no-session')
        return
      }
      setStatus('unverified')
      fetch('/api/gateway/v1/models', {
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
      })
        .then((res) => {
          if (cancelled) return
          setStatus(res.ok ? 'ok' : 'error')
        })
        .catch(() => {
          if (!cancelled) setStatus('error')
        })
    })
    return () => {
      cancelled = true
    }
  }, [])

  const meta = LABELS[status]
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            role="status"
            variant={meta.variant}
            className="h-auto gap-1.5 px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider"
          >
            <span className="size-1.5 rounded-full bg-current" />
            {meta.text}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>{meta.title}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

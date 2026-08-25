import { useEffect, useState } from 'react'

import { checkSession } from '#/lib/session-client'

export type HeaderStatus = 'no-session' | 'unverified' | 'ok' | 'error'

const LABELS: Record<HeaderStatus, { text: string; className: string; title: string }> = {
  'no-session': {
    text: 'signed out',
    className: 'text-destructive border-destructive/40',
    title: 'No active session — open Settings to sign in.',
  },
  unverified: {
    text: 'session',
    className: 'text-amber-400 border-amber-400/40',
    title: 'Session active but not yet verified — test it in Settings.',
  },
  ok: {
    text: 'live',
    className: 'text-neon-cyan border-neon-cyan/40',
    title: 'Connected to the backend via secure session.',
  },
  error: {
    text: 'offline',
    className: 'text-destructive border-destructive/40',
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
    <span
      role="status"
      title={meta.title}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider ${meta.className}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {meta.text}
    </span>
  )
}

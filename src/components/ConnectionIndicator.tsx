import { useEffect, useState } from 'react'

import {
  DEFAULT_API_BASE_URL,
  getCredentialProvider,
} from '#/lib/api-config'

export type HeaderStatus = 'no-key' | 'unverified' | 'ok' | 'error'

const LABELS: Record<HeaderStatus, { text: string; className: string; title: string }> = {
  'no-key': {
    text: 'no key',
    className: 'text-destructive border-destructive/40',
    title: 'No API key configured — open Settings to add one.',
  },
  unverified: {
    text: 'key set',
    className: 'text-amber-400 border-amber-400/40',
    title: 'API key stored but not yet verified — test it in Settings.',
  },
  ok: {
    text: 'live',
    className: 'text-neon-cyan border-neon-cyan/40',
    title: 'Connected to the backend.',
  },
  error: {
    text: 'offline',
    className: 'text-destructive border-destructive/40',
    title: 'Backend unreachable or rejected the key — see Settings.',
  },
}

/**
 * Persistent at-a-glance connection indicator for the header.
 * Verifies the stored key once per mount with a cheap authenticated call.
 */
export default function ConnectionIndicator() {
  const [status, setStatus] = useState<HeaderStatus>('no-key')

  useEffect(() => {
    let cancelled = false
    const provider = getCredentialProvider()
    const { apiKey } = provider.getCredentials()
    if (!apiKey) {
      setStatus('no-key')
      return
    }
    setStatus('unverified')
    fetch(`${provider.getBaseUrl() || DEFAULT_API_BASE_URL}/v1/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    })
      .then((res) => {
        if (cancelled) return
        setStatus(res.ok ? 'ok' : 'error')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Re-check when the user returns from Settings (key may have changed).
  useEffect(() => {
    function onFocus() {
      const provider = getCredentialProvider()
      if (!provider.getCredentials().apiKey) {
        setStatus('no-key')
      }
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const meta = LABELS[status]
  return (
    <a
      href="/settings"
      title={meta.title}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider no-underline ${meta.className}`}
    >
      <span
        className={`size-1.5 rounded-full ${
          status === 'ok'
            ? 'animate-pulse bg-neon-cyan shadow-[0_0_6px_var(--neon-cyan)]'
            : status === 'unverified'
              ? 'bg-amber-400'
              : 'bg-destructive'
        }`}
      />
      {meta.text}
    </a>
  )
}

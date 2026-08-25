import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { subscribeSse, type SseEvent } from './api-client'

/** Cheap authenticated probe of the gateway via the same-origin proxy. */
export function useGatewayStatus(_apiKey: string | null) {
  return useQuery({
    queryKey: ['gateway-status'],
    queryFn: async () => {
      const res = await fetch('/api/gateway/v1/models', { credentials: 'same-origin' })
      if (res.status === 401 || res.status === 403)
        throw new Error('unauthorized')
      if (!res.ok) throw new Error('server-error')
      return 'connected' as const
    },
    retry: false,
    staleTime: 30_000,
  })
}

export function useActivityFeed(_apiKey: string | null) {
  return useQuery({
    queryKey: ['activity-feed'],
    queryFn: async () => {
      const res = await fetch('/api/gateway/api/sessions', { credentials: 'same-origin' })
      if (!res.ok) throw new Error(`status ${res.status}`)
      return (await res.json()) as unknown[]
    },
  })
}

/**
 * Subscribe to an SSE endpoint through the same-origin proxy. The stream is
 * torn down and re-established when path or enabled changes.
 */
export function useAgentStream({
  path,
  enabled = true,
  onDelta,
  onToolStarted,
  onToolCompleted,
}: {
  path: string
  enabled?: boolean
  apiKey?: string | null
  onDelta?: (text: string) => void
  onToolStarted?: (tool: string, callId?: string) => void
  onToolCompleted?: (tool: string, ok?: boolean, callId?: string) => void
}) {
  const [lastError, setLastError] = useState<unknown>(null)

  useEffect(() => {
    if (!enabled || !path) {
      setLastError(null)
      return
    }
    let cancelled = false
    const unsubscribe = subscribeSse(path, null, {
      onDelta: (t) => !cancelled && onDelta?.(t),
      onToolStarted: (tool, callId) => !cancelled && onToolStarted?.(tool, callId),
      onToolCompleted: (tool, ok, callId) =>
        !cancelled && onToolCompleted?.(tool, ok, callId),
      onError: (err) => !cancelled && setLastError(err),
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
    // Handlers are read at effect setup; callers pass stable callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, enabled])

  return { lastError }
}

export type { SseEvent }

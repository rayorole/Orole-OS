import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { apiFetch, subscribeSse, type SseEvent } from './api-client'

/**
 * Live gateway status probe (dashboard "Core Diagnostics" panel).
 * loading -> success | error via TanStack Query.
 */
export function useGatewayStatus(apiKey: string | null) {
  return useQuery({
    queryKey: ['gateway-status', apiKey],
    queryFn: () => apiFetch('/v1/models', { apiKey }),
    refetchInterval: 30_000,
    retry: false,
    enabled: typeof window !== 'undefined',
  })
}

/** Run-history feed for the dashboard activity panel. */
export function useActivityFeed(apiKey: string | null) {
  return useQuery({
    queryKey: ['activity-feed', apiKey],
    queryFn: () => apiFetch<unknown[]>('/api/sessions', { apiKey }),
    refetchInterval: 15_000,
    retry: false,
    enabled: typeof window !== 'undefined',
  })
}

export interface AgentStreamState {
  events: SseEvent[]
  text: string
  isStreaming: boolean
  error: unknown
}

/**
 * Subscribe to an agent run's SSE stream. Cleans up (aborts the fetch) on
 * unmount or when the key changes, so no listener outlives its component.
 */
export function useAgentStream(
  path: string,
  apiKey: string | null,
): AgentStreamState {
  const [state, setState] = useState<AgentStreamState>({
    events: [],
    text: '',
    isStreaming: true,
    error: null,
  })

  useEffect(() => {
    if (!apiKey) {
      setState({ events: [], text: '', isStreaming: false, error: null })
      return
    }
    let cancelled = false
    setState((s) => ({ ...s, isStreaming: true }))

    const unsubscribe = subscribeSse(path, apiKey, {
      onDelta: (text) =>
        !cancelled &&
        setState((s) => ({ ...s, text: s.text + text })),
      onRaw: (event) =>
        !cancelled &&
        setState((s) => ({ ...s, events: [...s.events, event] })),
      onError: (err) =>
        !cancelled && setState((s) => ({ ...s, error: err, isStreaming: false })),
    })

    return () => {
      cancelled = true
      unsubscribe()
      setState((s) => ({ ...s, isStreaming: false }))
    }
  }, [path, apiKey])

  return state
}

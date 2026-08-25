/**
 * Polled aggregate endpoint client (issue #34, requirement 2).
 *
 * Cost / token aggregates are NEVER reconstructed client-side from event
 * streams. The UI polls this authoritative endpoint instead.
 */

import { useQuery } from '@tanstack/react-query'

const HERMES_BASE_URL = (import.meta.env.VITE_HERMES_BASE_URL ?? '').replace(/\/$/, '')
const HERMES_API_KEY = import.meta.env.VITE_HERMES_API_KEY ?? ''

function headers(): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/json' }
  if (HERMES_API_KEY) h.Authorization = `Bearer ${HERMES_API_KEY}`
  return h
}

export interface CostAggregate {
  totalCostUsd: number
  totalTokensIn: number
  totalTokensOut: number
  byAgent?: Record<string, { costUsd: number; tokens: number }>
  window?: string
  [k: string]: unknown
}

export async function fetchCostAggregate(window = '24h'): Promise<CostAggregate> {
  const res = await fetch(
    `${HERMES_BASE_URL}/v1/metrics/costs?window=${encodeURIComponent(window)}`,
    { headers: headers() },
  )
  if (!res.ok) throw new Error(`cost aggregate failed: HTTP ${res.status}`)
  return (await res.json()) as CostAggregate
}

/**
 * Poll the aggregate endpoint on an interval. This is the ONLY source of
 * cost/token totals in the UI — stream events merely invalidate ['runs'].
 */
export function useCostAggregate(window = '24h', refetchIntervalMs = 30_000) {
  return useQuery({
    queryKey: ['cost-aggregate', window],
    queryFn: () => fetchCostAggregate(window),
    refetchInterval: refetchIntervalMs,
    staleTime: 15_000,
  })
}

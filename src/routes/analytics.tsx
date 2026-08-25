import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { PanelState } from '#/components/states'
import { apiFetch } from '#/lib/api-client'

export const Route = createFileRoute('/analytics')({
  component: Analytics,
})

interface UsageStats {
  totalRuns?: number
  tokensIn?: number
  tokensOut?: number
}

function getApiKey(): string | null {
  try {
    return window.localStorage.getItem('orole.apiKey')
  } catch {
    return null
  }
}

/** Aggregated usage analytics across the fleet. */
function Analytics() {
  const query = useQuery({
    queryKey: ['analytics'],
    queryFn: () => apiFetch<UsageStats>('/api/analytics', { apiKey: getApiKey() }),
    retry: false,
    enabled: typeof window !== 'undefined',
  })

  const stats = query.data ?? {}
  return (
    <main className="page-wrap px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>Analytics</CardTitle>
          <CardDescription>Fleet-wide run and token usage.</CardDescription>
        </CardHeader>
        <CardContent>
          <PanelState query={query} isEmpty={(d) => !d}>
            <dl data-testid="analytics-stats" className="grid gap-4 sm:grid-cols-3">
              {[
                ['Runs', stats.totalRuns],
                ['Tokens in', stats.tokensIn],
                ['Tokens out', stats.tokensOut],
              ].map(([label, value]) => (
                <div key={label as string} className="rounded-lg border p-4">
                  <dt className="font-mono text-xs uppercase tracking-widest text-[var(--muted-foreground)]">
                    {label}
                  </dt>
                  <dd className="text-2xl font-bold">{String(value ?? '—')}</dd>
                </div>
              ))}
            </dl>
          </PanelState>
        </CardContent>
      </Card>
    </main>
  )
}

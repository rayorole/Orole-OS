import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  LineChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '#/components/ui/empty'
import { Skeleton } from '#/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '#/components/ui/tabs'
import {
  TIME_RANGES,
  colorFor,
  deriveActivity,
  deriveRuns,
  deriveTokenCost,
  deriveToolUsage,
  fetchAnalyticsData,
  type AnalyticsData,
  type TimeRange,
} from '#/lib/analytics'

/* ── Shared chart chrome (dark HUD) ────────────────────────────────────── */

const AXIS_STYLE = { stroke: 'rgba(255,255,255,0.25)', fontSize: 11 }
const GRID = 'rgba(148,163,184,0.12)'

type TooltipEntry = { dataKey?: string | number; name?: string; value?: number | string; color?: string }

function HudTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: TooltipEntry[]
  label?: string | number
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[oklch(0.18_0.025_260/0.95)] px-3 py-2 text-xs shadow-[0_0_24px_var(--grid-glow)] backdrop-blur">
      <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-neon-cyan/80">
        {label}
      </p>
      {payload.map((p, i) => (
        <p key={p.dataKey ?? i} style={{ color: p.color }}>
          {p.name}: <span className="font-mono font-semibold">{p.value}</span>
        </p>
      ))}
    </div>
  )
}

function HudEmptyState({
  icon,
  title,
  description,
  className,
}: {
  icon?: React.ReactNode
  title: string
  description?: string
  className?: string
}) {
  return (
    <Empty className={className}>
      {icon && (
        <EmptyMedia variant="icon">
          {icon}
        </EmptyMedia>
      )}
      <EmptyHeader>
        <EmptyTitle className="font-mono text-sm uppercase tracking-widest text-[var(--neon-cyan)]/80">
          {title}
        </EmptyTitle>
        {description && (
          <EmptyDescription className="max-w-md text-[var(--muted-foreground)]">
            {description}
          </EmptyDescription>
        )}
      </EmptyHeader>
    </Empty>
  )
}

function ChartPanel({
  title,
  description,
  isEmpty,
  emptyTitle = 'No data in range',
  children,
  span = '',
}: {
  title: string
  description?: string
  isEmpty: boolean
  emptyTitle?: string
  children: React.ReactNode
  span?: string
}) {
  return (
    <Card className={`border-neon-cyan/15 shadow-[0_0_28px_var(--grid-glow)] ${span}`}>
      <CardHeader>
        <CardTitle className="font-mono text-sm uppercase tracking-[0.2em] text-neon-cyan">
          {title}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        {isEmpty ? (
          <div className="flex h-64 items-center justify-center">
            <HudEmptyState title={emptyTitle} description="Nothing recorded in the selected time window." />
          </div>
        ) : (
          <div className="h-64 w-full">{children}</div>
        )}
      </CardContent>
    </Card>
  )
}

/* ── Time-range selector ───────────────────────────────────────────────── */

function RangeSelector({ value, onChange }: { value: TimeRange; onChange: (r: TimeRange) => void }) {
  return (
    <Tabs value={value} onValueChange={(v) => onChange(v as TimeRange)}>
      <TabsList aria-label="Time range" className="rounded-full border border-neon-cyan/30 bg-card">
        {TIME_RANGES.map((r) => (
          <TabsTrigger
            key={r.value}
            value={r.value}
            className="px-4 font-mono text-xs tracking-widest data-[state=active]:shadow-[0_0_12px_var(--grid-glow)]"
          >
            {r.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="gap-2 border-neon-cyan/15 py-4 shadow-[0_0_20px_var(--grid-glow)]">
      <CardHeader className="gap-1 px-4">
        <CardDescription className="font-mono text-[10px] uppercase tracking-[0.25em]">
          {label}
        </CardDescription>
        <CardTitle className="text-2xl text-neon-cyan">{value}</CardTitle>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </CardHeader>
    </Card>
  )
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

/* ── Route ─────────────────────────────────────────────────────────────── */

export const Route = createFileRoute('/analytics')({
  component: AnalyticsDashboard,
})

function useAnalytics() {
  return useQuery<AnalyticsData>({
    queryKey: ['analytics'],
    queryFn: fetchAnalyticsData,
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: 1,
  })
}

function AnalyticsDashboard() {
  const [range, setRange] = useState<TimeRange>('24h')
  const { data, isPending, isError, error } = useAnalytics()
  const rangeMs = TIME_RANGES.find((r) => r.value === range)!.ms

  const activity = useMemo(
    () => (data ? deriveActivity(data, rangeMs) : null),
    [data, rangeMs],
  )
  const tokenCost = useMemo(
    () => (data ? deriveTokenCost(data, rangeMs) : null),
    [data, rangeMs],
  )
  const tools = useMemo(() => (data ? deriveToolUsage(data, rangeMs) : null), [data, rangeMs])
  const runs = useMemo(() => (data ? deriveRuns(data, rangeMs) : null), [data, rangeMs])

  const loading = isPending
  const noData = !!data && data.sessions.length === 0 && data.runs.length === 0

  const totalTokens = tokenCost?.reduce((a, u) => a + u.totalTokens, 0) ?? 0
  const totalCost = tokenCost?.reduce((a, u) => a + u.cost, 0) ?? 0
  const totalRuns = (runs?.success ?? 0) + (runs?.failed ?? 0)
  const successRate = totalRuns ? Math.round((runs!.success / totalRuns) * 100) : null

  if (isError) {
    return (
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-16 sm:px-6">
        <Alert variant="destructive">
          <AlertTitle>Telemetry offline</AlertTitle>
          <AlertDescription>
            Could not reach the Hermes API ({(error as Error)?.message ?? 'unknown error'}). Charts
            will populate once a gateway is connected.
          </AlertDescription>
        </Alert>
      </main>
    )
  }

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.35em] text-neon-violet">telemetry</p>
          <h1 className="bg-gradient-to-r from-neon-cyan via-foreground to-neon-violet bg-clip-text text-3xl font-bold text-transparent md:text-4xl">
            Analytics
          </h1>
        </div>
        <RangeSelector value={range} onChange={setRange} />
      </div>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <Card key={i} className="border-neon-cyan/15">
              <CardContent className="pt-6">
                <Skeleton className="h-64 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : noData ? (
        <>
          <HudEmptyState
            icon={<span className="text-2xl">🛰</span>}
            title="No telemetry yet"
            description="Once your Hermes agents run sessions, activity, tokens and outcomes will chart here."
          />
          <div className="grid gap-4 sm:grid-cols-3">
            <StatTile label="Total tokens" value="0" />
            <StatTile label="Est. cost" value="$0.00" />
            <StatTile label="Run success rate" value="—" sub="0 ok · 0 failed" />
          </div>
        </>
      ) : (
        <>
          {/* Totals strip */}
          <div className="grid gap-4 sm:grid-cols-3">
            <StatTile label="Total tokens" value={fmtNum(totalTokens)} />
            <StatTile label="Est. cost" value={`$${totalCost.toFixed(2)}`} />
            <StatTile
              label="Run success rate"
              value={successRate == null ? '—' : `${successRate}%`}
              sub={`${runs?.success ?? 0} ok · ${runs?.failed ?? 0} failed`}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <ChartPanel
              title="Activity over time"
              description="Messages/events per agent"
              isEmpty={!activity || activity.agents.length === 0}
              span="md:col-span-2"
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={activity!.points} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                  <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
                  <XAxis dataKey="bucket" tick={AXIS_STYLE} tickLine={false} stroke={AXIS_STYLE.stroke} minTickGap={24} />
                  <YAxis tick={AXIS_STYLE} tickLine={false} stroke={AXIS_STYLE.stroke} allowDecimals={false} />
                  <Tooltip content={<HudTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {activity!.agents.map((a, i) => (
                    <Line
                      key={a}
                      type="monotone"
                      dataKey={a}
                      stroke={colorFor(i)}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </ChartPanel>

            <ChartPanel
              title="Tokens & cost per agent"
              description="Stacked input/output tokens"
              isEmpty={!tokenCost || tokenCost.length === 0}
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={tokenCost ?? []} layout="vertical" margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                  <CartesianGrid stroke={GRID} strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={AXIS_STYLE} tickLine={false} stroke={AXIS_STYLE.stroke} />
                  <YAxis type="category" dataKey="agent" tick={AXIS_STYLE} tickLine={false} width={80} stroke={AXIS_STYLE.stroke} />
                  <Tooltip content={<HudTooltip />} formatter={(v: unknown) => fmtNum(Number(v))} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="inputTokens" name="Input" stackId="t" fill="#38bdf8" />
                  <Bar dataKey="outputTokens" name="Output" stackId="t" fill="#a78bfa" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartPanel>

            <ChartPanel
              title="Skills invoked"
              description="Top invocations"
              isEmpty={!tools || tools.skills.length === 0}
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={tools!.skills} layout="vertical" margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                  <CartesianGrid stroke={GRID} strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={AXIS_STYLE} tickLine={false} stroke={AXIS_STYLE.stroke} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={AXIS_STYLE} tickLine={false} width={120} stroke={AXIS_STYLE.stroke} />
                  <Tooltip content={<HudTooltip />} />
                  <Bar dataKey="count" name="Invocations" fill="#5eead4" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartPanel>

            <ChartPanel
              title="MCP tools called"
              description="server:tool breakdown"
              isEmpty={!tools || tools.mcpTools.length === 0}
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={tools!.mcpTools} layout="vertical" margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                  <CartesianGrid stroke={GRID} strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={AXIS_STYLE} tickLine={false} stroke={AXIS_STYLE.stroke} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={AXIS_STYLE} tickLine={false} width={130} stroke={AXIS_STYLE.stroke} />
                  <Tooltip content={<HudTooltip />} />
                  <Bar dataKey="count" name="Calls" fill="#fbbf24" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartPanel>

            <ChartPanel
              title="Run duration distribution"
              description="Runs grouped by length"
              isEmpty={!runs || runs.durations.every((d) => d.count === 0)}
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={runs!.durations} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                  <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={AXIS_STYLE} tickLine={false} stroke={AXIS_STYLE.stroke} />
                  <YAxis tick={AXIS_STYLE} tickLine={false} stroke={AXIS_STYLE.stroke} allowDecimals={false} />
                  <Tooltip content={<HudTooltip />} />
                  <Bar dataKey="count" name="Runs" radius={[4, 4, 0, 0]}>
                    {runs!.durations.map((_, i) => (
                      <Cell key={i} fill={colorFor(i + 2)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartPanel>

            <ChartPanel
              title="Success vs failed"
              description={successRate == null ? undefined : `${successRate}% success`}
              isEmpty={totalRuns === 0}
            >
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={[
                      { name: 'Success', value: runs!.success },
                      { name: 'Failed', value: runs!.failed },
                    ]}
                    dataKey="value"
                    innerRadius="55%"
                    outerRadius="80%"
                    paddingAngle={3}
                    strokeWidth={0}
                  >
                    <Cell fill="#34d399" />
                    <Cell fill="#f43f5e" />
                  </Pie>
                  <Tooltip content={<HudTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </ChartPanel>
          </div>
        </>
      )}
    </main>
  )
}

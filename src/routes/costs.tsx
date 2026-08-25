import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card'
import { CreditsGauge } from '#/components/CreditsGauge'
import { formatUsd, useCountUp } from '#/components/CostTicker'
import {
  DAY_MS,
  MONTHLY_BUDGET_USD,
  useLiveUsage,
  type ConnState,
} from '#/lib/cost-data'

export const Route = createFileRoute('/costs')({
  component: CostDashboard,
})

/* ── Window selector: today / 7d / 30d ─────────────────────────────────── */

const WINDOWS = [
  { value: 'today', label: 'Today', ms: DAY_MS },
  { value: '7d', label: '7D', ms: 7 * DAY_MS },
  { value: '30d', label: '30D', ms: 30 * DAY_MS },
] as const

type WindowKey = (typeof WINDOWS)[number]['value']

function WindowSelector({ value, onChange }: { value: WindowKey; onChange: (w: WindowKey) => void }) {
  return (
    <div
      role="tablist"
      aria-label="Cost window"
      className="inline-flex overflow-hidden rounded-full border border-neon-cyan/30 bg-card"
    >
      {WINDOWS.map((w) => (
        <button
          key={w.value}
          role="tab"
          aria-selected={value === w.value}
          onClick={() => onChange(w.value)}
          className={`px-4 py-1.5 font-mono text-xs tracking-widest transition ${
            value === w.value
              ? 'bg-primary text-primary-foreground shadow-[0_0_12px_var(--grid-glow)]'
              : 'text-muted-foreground hover:text-neon-cyan'
          }`}
        >
          {w.label}
        </button>
      ))}
    </div>
  )
}

/* ── Live connection pill ──────────────────────────────────────────────── */

const CONN_LABEL: Record<ConnState, string> = {
  idle: 'IDLE',
  connecting: 'SYNC…',
  live: 'LIVE',
  reconnecting: 'RECONNECT…',
  stale: 'STALE',
}

const CONN_CLASS: Record<ConnState, string> = {
  idle: 'border-[var(--border)] text-muted-foreground',
  connecting: 'border-neon-cyan/40 text-neon-cyan',
  live: 'border-emerald-400/50 text-emerald-400',
  reconnecting: 'border-amber-400/50 text-amber-400',
  stale: 'border-red-400/60 text-red-400',
}

function ConnPill({ conn }: { conn: ConnState }) {
  const pulse = conn === 'live' || conn === 'reconnecting' || conn === 'connecting'
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.25em] ${CONN_CLASS[conn]}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full bg-current ${pulse ? 'animate-pulse' : ''}`}
        aria-hidden="true"
      />
      {CONN_LABEL[conn]}
    </span>
  )
}

/* ── Ticker card ───────────────────────────────────────────────────────── */

function TickerCard({
  label,
  amount,
  estimated,
}: {
  label: string
  amount: number
  estimated?: boolean
}) {
  const animated = useCountUp(amount)
  return (
    <Card className="gap-2 border-neon-cyan/15 py-4 shadow-[0_0_20px_var(--grid-glow)]">
      <CardHeader className="gap-1 px-4">
        <CardDescription className="font-mono text-[10px] uppercase tracking-[0.25em]">
          {label}
        </CardDescription>
        <CardTitle className="font-mono text-3xl tabular-nums text-neon-cyan">
          {formatUsd(animated)}
          {estimated && (
            <span
              title="Unknown model priced at blended estimate"
              className="ml-2 align-middle rounded bg-amber-400/10 px-1.5 py-0.5 font-mono text-[10px] tracking-widest text-amber-400"
            >
              EST.
            </span>
          )}
        </CardTitle>
      </CardHeader>
    </Card>
  )
}

/* ── Route component ───────────────────────────────────────────────────── */

const AXIS_STYLE = { stroke: 'rgba(255,255,255,0.25)', fontSize: 11 }
const BUDGET_WINDOW_MS = 30 * DAY_MS

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function fmtDay(day: string): string {
  const d = new Date(`${day}T00:00:00`)
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

type TooltipEntry = { name?: string; value?: number | string }

function HudTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipEntry[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[oklch(0.18_0.025_260/0.95)] px-3 py-2 text-xs shadow-[0_0_24px_var(--grid-glow)] backdrop-blur">
      <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-neon-cyan/80">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="text-neon-violet">
          spend:{' '}
          <span className="font-mono font-semibold">{formatUsd(Number(p.value ?? 0))}</span>
        </p>
      ))}
    </div>
  )
}

function CostDashboard() {
  const [win, setWin] = useState<WindowKey>('today')
  const windowMs = WINDOWS.find((w) => w.value === win)!.ms
  const { summary, conn, error } = useLiveUsage(windowMs)

  // Burn-down always shows the full 30d history regardless of selector.
  const burndown = useLiveUsage(BUDGET_WINDOW_MS)
  const daily = useMemo(() => burndown.summary?.daily ?? [], [burndown.summary])

  const agents = summary?.agents ?? []
  const totalTokens =
    (summary?.agents.reduce((a, u) => a + u.inputTokens + u.outputTokens, 0) ?? 0)

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.35em] text-neon-violet">burn rate</p>
          <h1 className="bg-gradient-to-r from-neon-cyan via-foreground to-neon-violet bg-clip-text text-3xl font-bold text-transparent md:text-4xl">
            Cost &amp; Credits
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <ConnPill conn={conn} />
          <WindowSelector value={win} onChange={setWin} />
        </div>
      </div>

      {error && conn === 'stale' && (
        <p className="rounded-md border border-red-400/40 bg-red-400/5 px-4 py-2 text-sm text-red-400">
          Live feed stale — showing last known values ({error}). Retrying automatically.
        </p>
      )}

      {/* Ticker strip */}
      <div className="grid gap-4 sm:grid-cols-3">
        <TickerCard
          label={win === 'today' ? "Today's total" : `${WINDOWS.find((w) => w.value === win)!.label} total`}
          amount={summary?.totalCost ?? 0}
          estimated={summary?.totalEstimated}
        />
        <TickerCard label="Agents active" amount={agents.length} />
        <TickerCard label="Tokens in window" amount={totalTokens} />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {/* Per-agent breakdown */}
        <Card className="border-neon-cyan/15 shadow-[0_0_28px_var(--grid-glow)] md:col-span-2">
          <CardHeader>
            <CardTitle className="font-mono text-sm uppercase tracking-[0.2em] text-neon-cyan">
              Per-agent breakdown
            </CardTitle>
            <CardDescription>Token usage and dollar cost by agent</CardDescription>
          </CardHeader>
          <CardContent>
            {agents.length === 0 ? (
              <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-[var(--border)] text-sm text-muted-foreground">
                No usage recorded in the selected window.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    <th className="cursor-pointer py-2 pr-3">Agent</th>
                    <th className="py-2 pr-3">In</th>
                    <th className="py-2 pr-3">Out</th>
                    <th className="py-2 pr-3">$</th>
                    <th className="py-2">Last activity</th>
                  </tr>
                </thead>
                <tbody>
                  {agents.map((a) => (
                    <tr key={a.agent} className="border-b border-[var(--border)]/50">
                      <td className="py-2 pr-3 font-medium">
                        {a.agent}
                        {a.estimated && (
                          <span
                            title="Unknown model — blended estimate"
                            className="ml-2 rounded bg-amber-400/10 px-1 py-0.5 font-mono text-[9px] tracking-widest text-amber-400"
                          >
                            EST.
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3 font-mono text-muted-foreground">{fmtNum(a.inputTokens)}</td>
                      <td className="py-2 pr-3 font-mono text-muted-foreground">{fmtNum(a.outputTokens)}</td>
                      <td className="py-2 pr-3 font-mono font-semibold text-neon-cyan">
                        {a.cost.toFixed(4).replace(/0+$/, '').replace(/\.$/, '.00')}
                      </td>
                      <td className="py-2 font-mono text-xs text-muted-foreground">
                        {a.lastActivity
                          ? new Date(a.lastActivity).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        {/* Credits gauge */}
        <CreditsGauge spent={summary?.totalCost ?? 0} budget={MONTHLY_BUDGET_USD} />

        {/* Burn-down sparkline */}
        <Card className="border-neon-cyan/15 shadow-[0_0_28px_var(--grid-glow)] md:col-span-2 xl:col-span-3">
          <CardHeader>
            <CardTitle className="font-mono text-sm uppercase tracking-[0.2em] text-neon-cyan">
              Spend burn-down
            </CardTitle>
            <CardDescription>Daily spend across the last 30 days</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={daily.map((d) => ({ ...d, label: fmtDay(d.day) }))} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                  <defs>
                    <linearGradient id="spendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#5eead4" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="#5eead4" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="label" tick={AXIS_STYLE} tickLine={false} stroke={AXIS_STYLE.stroke} minTickGap={28} />
                  <YAxis tick={AXIS_STYLE} tickLine={false} stroke={AXIS_STYLE.stroke} tickFormatter={(v: number) => `$${v}`} />
                  <Tooltip content={<HudTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="cost"
                    name="spend"
                    stroke="#5eead4"
                    strokeWidth={2}
                    fill="url(#spendFill)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}

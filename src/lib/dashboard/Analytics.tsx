// Analytics section (extends issue #13): recharts over tokens/costs/skills/
// MCP usage with a shared time-range selector.

import { useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useAnalytics } from './api'
import { EmptyState, ErrorState, PanelSkeleton, PanelShell } from './states'
import type { TimeRange } from './types'

const RANGES: TimeRange[] = ['1h', '24h', '7d', '30d']

export function TimeRangeSelector({
  value,
  onChange,
}: {
  value: TimeRange
  onChange: (r: TimeRange) => void
}) {
  return (
    <div
      className="flex gap-1 rounded-lg border border-border/50 p-1"
      role="radiogroup"
      aria-label="Time range"
    >
      {RANGES.map((r) => (
        <button
          key={r}
          type="button"
          role="radio"
          aria-checked={value === r}
          onClick={() => onChange(r)}
          className={`rounded px-3 py-1 font-mono text-xs uppercase tracking-widest transition-colors ${
            value === r
              ? 'bg-neon-cyan/15 text-neon-cyan shadow-[0_0_12px_rgba(0,255,255,0.15)]'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {r}
        </button>
      ))}
    </div>
  )
}

export function AnalyticsSection({
  range,
}: {
  range: TimeRange
}) {
  const { data, loading, error } = useAnalytics(range)
  const points = useMemo(() => data ?? [], [data])

  return (
    <PanelShell
      title="fleet analytics"
      subtitle={`tokens · cost · skills · mcp — last ${range}`}
    >
      {loading && points.length === 0 ? (
        <PanelSkeleton rows={5} />
      ) : error ? (
        <ErrorState message={error} />
      ) : points.length === 0 ? (
        <EmptyState
          title="no analytics yet"
          hint="Metrics stream in once agents start running tasks."
        />
      ) : (
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
              <defs>
                <linearGradient id="gTokens" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#22d3ee" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="gCost" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#a78bfa" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="gRuns" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#fbbf24" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#fbbf24" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(120,140,160,0.15)" />
              <XAxis
                dataKey="t"
                tick={{ fill: 'rgba(150,170,190,0.7)', fontSize: 11 }}
                stroke="rgba(120,140,160,0.3)"
              />
              <YAxis
                tick={{ fill: 'rgba(150,170,190,0.7)', fontSize: 11 }}
                stroke="rgba(120,140,160,0.3)"
              />
              <Tooltip
                contentStyle={{
                  background: 'rgba(10,14,20,0.92)',
                  border: '1px solid rgba(34,211,238,0.25)',
                  borderRadius: 8,
                  fontFamily: 'monospace',
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11, fontFamily: 'monospace' }} />
              <Area
                type="monotone"
                dataKey="tokens"
                name="tokens"
                stroke="#22d3ee"
                fill="url(#gTokens)"
                strokeWidth={1.5}
              />
              <Area
                type="monotone"
                dataKey="costUsd"
                name="cost ($)"
                stroke="#a78bfa"
                fill="url(#gCost)"
                strokeWidth={1.5}
              />
              <Area
                type="monotone"
                dataKey="skillRuns"
                name="skill runs"
                stroke="#fbbf24"
                fill="url(#gRuns)"
                strokeWidth={1.5}
              />
              <Area
                type="monotone"
                dataKey="mcpCalls"
                name="mcp calls"
                stroke="#34d399"
                fillOpacity={0}
                strokeWidth={1.5}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </PanelShell>
  )
}

export function useTimeRange() {
  return useState<TimeRange>('24h')
}

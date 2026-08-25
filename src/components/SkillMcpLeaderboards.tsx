import { useState } from 'react'
import {
  ResponsiveContainer,
  Line,
  LineChart,
  PieChart,
  Pie,
  Cell,
  Tooltip,
} from 'recharts'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Badge } from '#/components/ui/badge'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '#/components/ui/empty'
import { ScrollArea } from '#/components/ui/scroll-area'
import { Skeleton } from '#/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '#/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '#/components/ui/tabs'
import { cn } from '#/lib/utils'
import {
  buildLeaderboard,
  buildMcpDonut,
  type LeaderboardRow,
  type McpSlice,
  type TimeWindow,
} from '#/lib/usage-aggregation'
import { useToolCalls } from '#/lib/use-usage'

/** HUD palette for donut segments (mirrors --chart-1..5 in styles.css). */
const HUD_PALETTE = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
]

export function segmentColor(i: number): string {
  return HUD_PALETTE[i % HUD_PALETTE.length]
}

/* ── Shared window selector ────────────────────────────────────────────── */

function WindowSelector({
  value,
  onChange,
}: {
  value: TimeWindow
  onChange: (w: TimeWindow) => void
}) {
  return (
    <Tabs value={value} onValueChange={(v) => onChange(v as TimeWindow)}>
      <TabsList aria-label="Time window">
        {(['7d', '30d'] as const).map((w) => (
          <TabsTrigger key={w} value={w} className="font-mono">
            {w}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}

/* ── Sparkline ─────────────────────────────────────────────────────────── */

function Sparkline({ daily, muted }: { daily: number[]; muted?: boolean }) {
  const data = daily.map((v, i) => ({ day: i, calls: v }))
  return (
    <div className="h-8 w-28" aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <Line
            type="monotone"
            dataKey="calls"
            stroke={muted ? 'var(--muted-foreground)' : 'var(--neon-cyan)'}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

/* ── Delta badge ───────────────────────────────────────────────────────── */

export function DeltaBadge({ deltaPct }: { deltaPct: number | null }) {
  if (deltaPct === null) {
    return <Badge variant="idle" className="font-mono">new</Badge>
  }
  const up = deltaPct >= 0
  return (
    <Badge variant={up ? 'running' : 'failed'} className="font-mono">
      {up ? '▲' : '▼'} {Math.abs(Math.round(deltaPct))}%
    </Badge>
  )
}

/* ── Leaderboard ───────────────────────────────────────────────────────── */

function Leaderboard({ rows }: { rows: LeaderboardRow[] }) {
  if (!rows.length) {
    return (
      <Empty data-testid="leaderboard-empty" className="border">
        <EmptyHeader>
          <EmptyTitle>No usage recorded</EmptyTitle>
          <EmptyDescription>
            No skill or tool usage recorded in this window yet.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <ScrollArea className="max-h-[28rem]">
      <Table data-testid="leaderboard">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-auto pb-2 pr-2 font-normal">#</TableHead>
            <TableHead className="h-auto pb-2 pr-2 font-normal">tool / skill</TableHead>
            <TableHead className="h-auto pb-2 pr-2 text-right font-normal">calls</TableHead>
            <TableHead className="h-auto pb-2 pr-2 font-normal">7-day trend</TableHead>
            <TableHead className="h-auto pb-2 text-right font-normal">vs prev</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.name} data-testid={`lb-row-${r.name}`}>
              <TableCell className="py-1.5 pr-2 font-mono text-xs text-muted-foreground">{r.rank}</TableCell>
              <TableCell
                className={cn(
                  'max-w-[16rem] truncate py-1.5 pr-2 font-mono text-sm',
                  r.isOthers && 'text-muted-foreground',
                )}
                title={r.name}
              >
                {r.name}
              </TableCell>
              <TableCell className="py-1.5 pr-2 text-right font-mono text-sm tabular-nums">{r.count}</TableCell>
              <TableCell className="py-1.5 pr-2">
                <Sparkline daily={r.daily} muted={r.isOthers} />
              </TableCell>
              <TableCell className="py-1.5 text-right">
                <DeltaBadge deltaPct={r.deltaPct} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ScrollArea>
  )
}

/* ── MCP donut ─────────────────────────────────────────────────────────── */

interface DonutEntry {
  name: string
  count: number
}

function donutFormatter(total: number) {
  // recharts Formatter signature: (value, name, item, index, payload) => ReactNode
  const fmt: React.ComponentProps<typeof Tooltip>['formatter'] = (
    value: unknown,
    name: unknown,
  ) => {
    const count = Number(value ?? 0)
    return [
      String(name),
      `${count} calls (${total ? Math.round((count / total) * 100) : 0}%)`,
    ]
  }
  return fmt
}

const tooltipContentStyle = {
  background: 'var(--popover)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  fontSize: 12,
  color: 'var(--popover-foreground)',
} as const

function McpDonut({ slices, total }: { slices: McpSlice[]; total: number }) {
  const formatter = donutFormatter(total)
  if (!total) {
    return (
      <Empty data-testid="donut-empty" className="border">
        <EmptyHeader>
          <EmptyTitle>No MCP calls</EmptyTitle>
          <EmptyDescription>
            No MCP server calls recorded in this window yet.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  const data: DonutEntry[] = slices.map((s) => ({ name: s.server, count: s.count }))
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
      <div className="relative h-52 w-52 shrink-0" data-testid="mcp-donut">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="count"
              nameKey="name"
              innerRadius="62%"
              outerRadius="92%"
              paddingAngle={2}
              strokeWidth={0}
              isAnimationActive={false}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={segmentColor(i)} />
              ))}
            </Pie>
            <Tooltip contentStyle={tooltipContentStyle} formatter={formatter} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-3xl font-bold tabular-nums">{total}</span>
          <span className="hud-panel-title">calls this window</span>
        </div>
      </div>
      <ScrollArea className="max-h-56 w-full" data-testid="donut-legend">
        <ul className="space-y-1.5 pr-3">
          {slices.map((s, i) => (
            <li key={s.server} className="flex items-center gap-2 text-sm">
              <span
                aria-hidden="true"
                className="size-2.5 shrink-0 rounded-full"
                style={{ background: segmentColor(i) }}
              />
              <span className="flex-1 truncate font-mono">{s.server}</span>
              <span className="font-mono tabular-nums text-muted-foreground">
                {s.count} · {Math.round(s.sharePct)}%
              </span>
            </li>
          ))}
        </ul>
      </ScrollArea>
    </div>
  )
}

/* ── Page ──────────────────────────────────────────────────────────────── */

export function SkillMcpLeaderboards() {
  const [window, setWindow] = useState<TimeWindow>('7d')
  const query = useToolCalls()
  const calls = query.data ?? []

  const rows = buildLeaderboard(calls, new Date(), window)
  const { slices, total } = buildMcpDonut(calls, new Date(), window)

  return (
    <div className="space-y-6" data-testid="skill-mcp-leaderboards">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Skill & MCP usage</h2>
          <p className="text-sm text-muted-foreground">
            Aggregated client-side from session tool-call history.
          </p>
        </div>
        <WindowSelector value={window} onChange={setWindow} />
      </div>

      {query.isPending && !query.isError && (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      )}

      {query.isError && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>Failed to load usage history</AlertTitle>
          <AlertDescription>{(query.error as Error).message}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Skills & tools leaderboard</CardTitle>
          <CardDescription>
            Top 10 by call count · remaining tools grouped as “others”.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Leaderboard rows={rows} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>MCP calls by server</CardTitle>
          <CardDescription>Share of MCP tool calls per server.</CardDescription>
        </CardHeader>
        <CardContent>
          <McpDonut slices={slices} total={total} />
        </CardContent>
      </Card>
    </div>
  )
}

import { useMemo, useState } from 'react'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '#/components/ui/tooltip'
import { cn } from '#/lib/utils'
import {
  bucketRunsByDay,
  buildGrid,
  cellColor,
  type HeatmapRun,
  type WeekRange,
} from '#/lib/heatmap'
import { useLiveRuns } from '#/lib/use-live-runs'

const WEEK_OPTIONS: { value: WeekRange; label: string }[] = [
  { value: 13, label: '13W' },
  { value: 26, label: '26W' },
  { value: 52, label: '52W' },
]

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

interface DayTooltipProps {
  date: Date
  total: number
  succeeded: number
  failed: number
}

function DayTooltip({ date, total, succeeded, failed }: DayTooltipProps) {
  const pct = total > 0 ? Math.round((failed / total) * 100) : null
  return (
    <div className="space-y-0.5 font-mono">
      <p className="text-foreground">{formatDate(date)}</p>
      <p className="text-muted-foreground">{total} runs</p>
      <p className="text-status-running">✓ {succeeded} succeeded</p>
      <p className="text-status-failed">✗ {failed} failed</p>
      {pct !== null && (
        <p className="text-muted-foreground">failure rate {pct}%</p>
      )}
    </div>
  )
}

export interface RunHeatmapProps {
  /** Historical runs (REST). Live SSE completions are merged automatically. */
  runs: HeatmapRun[]
  /** Fired when a day is clicked — hook up activity-feed filtering here. */
  onSelectDay?: (dayKey: string) => void
  /** Currently selected day key, if click-to-filter is active. */
  selectedDayKey?: string | null
  className?: string
}

/**
 * GitHub-contribution-grid heatmap of run outcomes per day.
 * Columns = weeks, rows = weekdays; hue = success/failure ratio,
 * intensity = total volume.
 */
export function RunHeatmap({
  runs,
  onSelectDay,
  selectedDayKey,
  className,
}: RunHeatmapProps) {
  const [weeks, setWeeks] = useState<WeekRange>(26)
  const liveRuns = useLiveRuns()

  const columns = useMemo(() => {
    // Merge historical + live streams, de-duped by endedAt+status identity of
    // the live store (live store already upserts by id; historical list is the
    // REST catch-up so ids may overlap — prefer live entries).
    const all: HeatmapRun[] = [...runs]
    for (const r of liveRuns) all.push({ endedAt: r.endedAt, status: r.status })
    return buildGrid(bucketRunsByDay(all), weeks)
  }, [runs, liveRuns, weeks])

  return (
    <Card className={cn('gap-4', className)}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div className="space-y-1">
          <CardTitle className="hud-panel-title text-base font-semibold tracking-normal">
            Run outcomes
          </CardTitle>
          <CardDescription className="font-mono text-xs">
            success / failure per day
          </CardDescription>
        </div>
        <div
          role="group"
          aria-label="Time range"
          className="flex gap-1 rounded-md border border-border p-0.5"
        >
          {WEEK_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              aria-pressed={weeks === o.value}
              onClick={() => setWeeks(o.value)}
              className={cn(
                'rounded px-2 py-0.5 font-mono text-xs transition-colors',
                weeks === o.value
                  ? 'bg-primary/20 text-neon-cyan'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {/* Horizontal scroll on narrow screens with edge fade */}
        <div className="relative">
          <div className="heatmap-scroll overflow-x-auto pb-1">
            <TooltipProvider>
              <table
                role="grid"
                aria-label="Run outcome heatmap"
                className="border-separate border-spacing-[3px]"
              >
                <tbody>
                  <tr>
                    <td className="w-8" />
                    {columns.map((_, w) => (
                      <td key={w} />
                    ))}
                    <td className="w-12" />
                  </tr>
                  {WEEKDAY_LABELS.map((label, d) =>
                    d === 1 || d === 3 || d === 5 ? (
                      <tr key={label}>                        <td className="pr-1 text-right font-mono text-[10px] leading-none text-muted-foreground">
                          {label}
                        </td>
                        {columns.map((col) => {
                          const cell = col[d]
                          const color = cellColor(cell.bucket)
                          const selected = cell.key === selectedDayKey
                          return (
                            <td key={cell.key}>
                              {cell.isFuture ? (
                                <span className="block size-[11px] rounded-[3px] opacity-0" />
                              ) : (
                                <Tooltip>
                                  <TooltipTrigger>
                                    <button
                                      type="button"
                                      aria-label={`${formatDate(cell.date)}: ${cell.bucket?.total ?? 0} runs`}
                                      onClick={() => onSelectDay?.(cell.key)}
                                      style={color ? { backgroundColor: color } : undefined}
                                      className={cn(
                                        'block size-[11px] rounded-[3px] transition-transform hover:scale-125 focus-visible:scale-125 focus-visible:outline focus-visible:outline-neon-cyan',
                                        !color && 'bg-muted',
                                        cell.isToday &&
                                          'ring-1 ring-neon-cyan ring-offset-1 ring-offset-background',
                                        selected && 'ring-2 ring-neon-violet',
                                      )}
                                    />
                                  </TooltipTrigger>
                                  <TooltipContent side="top">
                                    <DayTooltip
                                      date={cell.date}
                                      total={cell.bucket?.total ?? 0}
                                      succeeded={cell.bucket?.succeeded ?? 0}
                                      failed={cell.bucket?.failed ?? 0}
                                    />
                                  </TooltipContent>
                                </Tooltip>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    ) : null,
                  )}
                  {/* Remaining weekday rows (Sun/Wed/Fri shown; others blank for density) */}
                  {[0, 2, 4, 6].map((d) => (
                    <tr key={`blank-${d}`} className="hidden" aria-hidden />
                  ))}
                </tbody>
              </table>
            </TooltipProvider>
          </div>
          {/* Edge fades */}
          <div className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-background to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent" />
        </div>

        {/* Legend */}
        <div className="mt-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
            <span>fewer</span>
            <span className="size-[11px] rounded-[3px] bg-muted" />
            <span
              className="size-[11px] rounded-[3px]"
              style={{ backgroundColor: cellColor({ key: '', total: 1, succeeded: 1, failed: 0 })! }}
            />
            <span
              className="size-[11px] rounded-[3px]"
              style={{ backgroundColor: cellColor({ key: '', total: 5, succeeded: 5, failed: 0 })! }}
            />
            <span
              className="size-[11px] rounded-[3px]"
              style={{ backgroundColor: cellColor({ key: '', total: 10, succeeded: 10, failed: 0 })! }}
            />
            <span>more</span>
          </div>
          <div className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
            <span className="text-status-running">✓ success</span>
            <span aria-hidden>→</span>
            <span className="text-status-failed">✗ failure</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

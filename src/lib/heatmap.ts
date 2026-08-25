/**
 * Success/failure heatmap — data layer.
 *
 * Buckets finished runs into local-calendar day cells and maps each day to a
 * cell color: hue encodes the success/failure ratio (green → red, matching the
 * design-system status palette), lightness/intensity encodes total volume.
 * All functions are pure so vitest can verify bucketing + color mapping
 * without any network or DOM.
 */

export type RunOutcome = 'success' | 'failure' | 'other'

export interface HeatmapRun {
  id?: string
  /** Epoch ms of the run's completion (finished time). */
  endedAt: number | null
  status?: string
}

export interface DayBucket {
  /** ISO date key `YYYY-MM-DD` in local time. */
  key: string
  total: number
  succeeded: number
  failed: number
}

/* ── Day keying ─────────────────────────────────────────────────────────── */

/** Local-time `YYYY-MM-DD` key for an epoch-ms timestamp. */
export function dayKey(ms: number): string {
  const d = new Date(ms)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function classifyRun(status?: string): RunOutcome {
  if (!status) return 'other'
  switch (status.toLowerCase()) {
    case 'completed':
    case 'succeeded':
    case 'success':
    case 'ok':
    case 'finished':
      return 'success'
    case 'failed':
    case 'error':
      return 'failure'
    default:
      return 'other'
  }
}

/**
 * Bucket runs by local day. Days with zero runs still appear in the result
 * (with all-zero counts) when they fall inside the requested window — pass
 * the window via `days` keys to guarantee empty-day cells exist.
 */
export function bucketRunsByDay(
  runs: HeatmapRun[],
): Map<string, DayBucket> {
  const map = new Map<string, DayBucket>()
  for (const run of runs) {
    if (run.endedAt == null || !Number.isFinite(run.endedAt)) continue
    const key = dayKey(run.endedAt)
    let b = map.get(key)
    if (!b) {
      b = { key, total: 0, succeeded: 0, failed: 0 }
      map.set(key, b)
    }
    b.total += 1
    const outcome = classifyRun(run.status)
    if (outcome === 'success') b.succeeded += 1
    else if (outcome === 'failure') b.failed += 1
  }
  return map
}

/* ── Grid layout ────────────────────────────────────────────────────────── */

export type WeekRange = 13 | 26 | 52

export interface GridCell {
  key: string
  date: Date
  weekIndex: number
  weekday: number // 0 = Sunday
  bucket: DayBucket | null
  isToday: boolean
  isFuture: boolean
}

/**
 * Build the contribution grid: columns = weeks, rows = weekdays (Sun–Sat).
 * The window ends on today and spans `weeks` calendar weeks back, always
 * starting on a Sunday so rows align.
 */
export function buildGrid(
  buckets: Map<string, DayBucket>,
  weeks: WeekRange,
  now: Date = new Date(),
): GridCell[][] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  // End of the current (partial) week = upcoming Saturday.
  const endOfWeek = new Date(today)
  endOfWeek.setDate(endOfWeek.getDate() + (6 - endOfWeek.getDay()))
  const start = new Date(endOfWeek)
  start.setDate(start.getDate() - (weeks * 7 - 1))

  const columns: GridCell[][] = []
  for (let w = 0; w < weeks; w++) {
    const col: GridCell[] = []
    for (let d = 0; d < 7; d++) {
      const date = new Date(start)
      date.setDate(start.getDate() + w * 7 + d)
      const key = dayKey(date.getTime())
      col.push({
        key,
        date,
        weekIndex: w,
        weekday: d,
        bucket: buckets.get(key) ?? null,
        isToday: key === dayKey(today.getTime()),
        isFuture: date > today,
      })
    }
    columns.push(col)
  }
  return columns
}

/* ── Color scale ────────────────────────────────────────────────────────── */

/**
 * Cell color for a day bucket.
 *
 * - no runs          → empty track color (`--muted`)
 * - hue              → success/failure ratio mapped green→red on the
 *                      design-system status palette (running=green oklch
 *                      0.78/0.19/155 → failed red)
 * - lightness/chroma → intensity by total runs (log-scaled), so busy days pop
 *
 * Returns an oklch() string; `null` bucket or zero total yields null so the
 * caller can render the empty style.
 */
export function cellColor(bucket: DayBucket | null): string | null {
  if (!bucket || bucket.total === 0) return null

  const failureRatio = bucket.failed / bucket.total
  // Hue path from success-green (155) to failure-red (25) — the two status
  // palette anchors. Interpolate along the short arc through neutral amber
  // (80) which is exactly monotonic 155 → 80 → 25.
  const hue = 155 + (25 - 155) * failureRatio
  // Intensity: log scale over totals 1..20+; more runs = higher chroma +
  // lighter (more visible) cell.
  const t = Math.min(1, Math.log2(1 + bucket.total) / Math.log2(21)) // 0..1
  const chroma = 0.06 + 0.13 * t
  const lightness = 0.32 + 0.28 * t

  return `oklch(${lightness.toFixed(3)} ${chroma.toFixed(3)} ${hue.toFixed(1)})`
}

/** Failure percentage 0–100 for a bucket; null when no runs. */
export function failurePercent(bucket: DayBucket | null): number | null {
  if (!bucket || bucket.total === 0) return null
  return Math.round((bucket.failed / bucket.total) * 100)
}

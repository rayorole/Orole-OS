import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import { gaugeLevel, type GaugeLevel } from '#/lib/cost'

/**
 * Credits gauge (#29): spent vs budget. Amber above 70%, red above 90%
 * (thresholds live in `#/lib/cost` so tests and UI share them).
 * TODO(#29): budget is a configurable constant until a real provider
 * credit-balance source exists.
 */

const LEVEL_COLOR: Record<GaugeLevel, string> = {
  ok: 'text-neon-cyan',
  amber: 'text-amber-400',
  red: 'text-red-400',
}

const LEVEL_STROKE: Record<GaugeLevel, string> = {
  ok: 'stroke-neon-cyan',
  amber: 'stroke-amber-400',
  red: 'stroke-red-400',
}

export function CreditsGauge({ spent, budget }: { spent: number; budget: number }) {
  const level = gaugeLevel(spent, budget)
  const ratio = budget > 0 ? Math.min(1, Math.max(0, spent / budget)) : 0
  const pct = Math.round(ratio * 100)
  const RADIUS = 52
  const CIRC = 2 * Math.PI * RADIUS

  return (
    <Card className="border-neon-cyan/15 shadow-[0_0_28px_var(--grid-glow)]">
      <CardHeader>
        <CardTitle className="font-mono text-sm uppercase tracking-[0.2em] text-neon-cyan">
          Credit budget
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-2">
        <div className="relative h-36 w-36">
          <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90">
            <circle cx="64" cy="64" r={RADIUS} fill="none" stroke="rgba(148,163,184,0.15)" strokeWidth="10" />
            <circle
              cx="64"
              cy="64"
              r={RADIUS}
              fill="none"
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={CIRC}
              strokeDashoffset={CIRC * (1 - ratio)}
              className={`${LEVEL_STROKE[level]} transition-[stroke-dashoffset] duration-700`}
            />
          </svg>
          <div className={`absolute inset-0 flex flex-col items-center justify-center ${LEVEL_COLOR[level]}`}>
            <span className="font-mono text-2xl font-bold">{pct}%</span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          <span className={`font-mono font-semibold ${LEVEL_COLOR[level]}`}>${spent.toFixed(2)}</span>
          {' '}of ${budget.toFixed(0)} monthly budget
        </p>
      </CardContent>
    </Card>
  )
}

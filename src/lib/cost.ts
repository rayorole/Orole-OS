/**
 * Shared cost computation module for Orole-OS.
 *
 * Single source of truth for token → dollar pricing, consumed by the
 * analytics dashboard (#13) and the cost ticker / burn-down view (#29).
 * Do not duplicate this math elsewhere — import from `#/lib/cost`.
 */

/** $ per 1M tokens. */
export interface ModelPrice {
  input: number
  output: number
}

/**
 * Model prices ($/M input & output tokens). Keep in sync with provider
 * price sheets; unknown models fall back to ESTIMATE_PRICE and are flagged.
 */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  // OpenAI
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'o3': { input: 2, output: 8 },
  'o4-mini': { input: 1.1, output: 4.4 },
  // Anthropic
  'claude-opus-4-1': { input: 15, output: 75 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  // Google
  'gemini-2.5-pro': { input: 1.25, output: 10 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5 },
  // Local / self-hosted
  'local-model': { input: 0, output: 0 },
}

/**
 * Fallback blended rate used when a model is not in MODEL_PRICES.
 * Costs computed with it must be surfaced with an "est." marker.
 */
export const ESTIMATE_PRICE: ModelPrice = { input: 3, output: 12 }

export interface Usage {
  inputTokens?: number | null
  outputTokens?: number | null
  totalTokens?: number | null
}

export interface CostResult {
  /** Cost in dollars. */
  cost: number
  /** True when the model was unknown and the blended estimate was used. */
  estimated: boolean
  /** Resolved model key (lowercased). */
  model: string
}

function normalizeModel(model?: string | null): string {
  const m = (model ?? '').trim().toLowerCase()
  if (!m) return ''
  // tolerate prefixed forms like "openai/gpt-4o" or "anthropic/claude-..."
  if (!MODEL_PRICES[m] && m.includes('/')) {
    const tail = m.slice(m.lastIndexOf('/') + 1)
    if (MODEL_PRICES[tail]) return tail
  }
  return m
}

/** Look up the effective price for a model; falls back to the estimate. */
export function priceForModel(model?: string | null): { price: ModelPrice; estimated: boolean } {
  const key = normalizeModel(model)
  const price = MODEL_PRICES[key]
  if (price) return { price, estimated: false }
  return { price: ESTIMATE_PRICE, estimated: true }
}

/** Cost of a single usage record in dollars, with estimate flag. */
export function computeCost(usage: Usage, model?: string | null): CostResult {
  const { price, estimated } = priceForModel(model)
  let input = usage?.inputTokens ?? 0
  let output = usage?.outputTokens ?? 0
  if (!output && usage?.totalTokens != null) output = Math.max(0, usage.totalTokens - input)
  const cost =
    ((Number.isFinite(input) ? Math.max(0, input) : 0) / 1_000_000) * price.input +
    ((Number.isFinite(output) ? Math.max(0, output) : 0) / 1_000_000) * price.output
  return { cost, estimated, model: normalizeModel(model) }
}

/* ── Budget gauge thresholds (#29 credits gauge) ────────────────────────── */

/** Spent/budget ratio where the gauge turns amber, then red. */
export const GAUGE_THRESHOLDS = { amber: 0.7, red: 0.9 } as const

export type GaugeLevel = 'ok' | 'amber' | 'red'

/** Boundary-inclusive levels: exactly 70% → amber, exactly 90% → red. */
export function gaugeLevel(spent: number, budget: number): GaugeLevel {
  if (!(budget > 0)) return 'ok'
  const ratio = spent / budget
  if (ratio >= GAUGE_THRESHOLDS.red) return 'red'
  if (ratio >= GAUGE_THRESHOLDS.amber) return 'amber'
  return 'ok'
}

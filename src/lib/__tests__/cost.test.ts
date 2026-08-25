import { describe, expect, it } from 'vitest'

import {
  ESTIMATE_PRICE,
  GAUGE_THRESHOLDS,
  MODEL_PRICES,
  computeCost,
  gaugeLevel,
  priceForModel,
} from '../cost'

describe('priceForModel', () => {
  it('returns known prices exactly', () => {
    const { price, estimated } = priceForModel('gpt-4o')
    expect(price).toEqual(MODEL_PRICES['gpt-4o'])
    expect(estimated).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(priceForModel('GPT-4O').estimated).toBe(false)
    expect(priceForModel('GPT-4O').price).toEqual(MODEL_PRICES['gpt-4o'])
  })

  it('strips provider prefixes', () => {
    expect(priceForModel('openai/gpt-4o-mini').estimated).toBe(false)
    expect(priceForModel('anthropic/claude-haiku-4-5').price).toEqual(
      MODEL_PRICES['claude-haiku-4-5'],
    )
  })

  it('falls back to the blended estimate for unknown models', () => {
    const { price, estimated } = priceForModel('mystery-model-v9')
    expect(price).toEqual(ESTIMATE_PRICE)
    expect(estimated).toBe(true)
  })

  it('treats missing model as estimate', () => {
    expect(priceForModel(undefined).estimated).toBe(true)
    expect(priceForModel('').estimated).toBe(true)
  })
})

describe('computeCost', () => {
  it('prices input and output tokens separately at $/M rates', () => {
    // gpt-4o: $2.5/M in, $10/M out
    const r = computeCost({ inputTokens: 1_000_000, outputTokens: 500_000 }, 'gpt-4o')
    expect(r.estimated).toBe(false)
    expect(r.cost).toBeCloseTo(2.5 + 5, 10)
  })

  it('derives output tokens from total when output is missing', () => {
    const r = computeCost({ inputTokens: 200_000, totalTokens: 300_000 }, 'gpt-4o-mini')
    // out = 100k → 100_000/1M * 0.6 = 0.06 ; in → 200k/1M * 0.15 = 0.03
    expect(r.cost).toBeCloseTo(0.09, 10)
  })

  it('flags unknown models as estimates and uses blended rate', () => {
    const r = computeCost({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, 'unknown-x')
    expect(r.estimated).toBe(true)
    expect(r.cost).toBeCloseTo(ESTIMATE_PRICE.input + ESTIMATE_PRICE.output, 10)
  })

  it('handles zero, negative and non-finite usage defensively', () => {
    expect(computeCost({}, 'gpt-4o').cost).toBe(0)
    expect(computeCost({ inputTokens: -50 }, 'gpt-4o').cost).toBe(0)
    expect(computeCost({ inputTokens: NaN, outputTokens: Infinity }, 'gpt-4o').cost).toBe(0)
  })

  it('zero-priced local models cost nothing without the est. flag', () => {
    const r = computeCost({ inputTokens: 999_999, outputTokens: 999_999 }, 'local-model')
    expect(r.cost).toBe(0)
    expect(r.estimated).toBe(false)
  })

  it('per-agent sums reconcile with a daily total (acceptance: sums match)', () => {
    const usageRows = [
      { agent: 'coder', usage: { inputTokens: 120_000, outputTokens: 8_000 }, model: 'gpt-4o' },
      { agent: 'researcher', usage: { inputTokens: 40_000, outputTokens: 2_500 }, model: 'gpt-4o-mini' },
      { agent: 'coder', usage: { inputTokens: 30_000, outputTokens: 1_200 }, model: 'gpt-4o' },
    ]
    const perAgent = new Map<string, number>()
    let total = 0
    for (const row of usageRows) {
      const { cost } = computeCost(row.usage, row.model)
      perAgent.set(row.agent, (perAgent.get(row.agent) ?? 0) + cost)
      total += cost
    }
    const sumOfAgents = [...perAgent.values()].reduce((a, b) => a + b, 0)
    expect(sumOfAgents).toBeCloseTo(total, 12)
    // hand-check coder: (150_000*2.5 + 9_200*10)/1M
    expect(perAgent.get('coder')).toBeCloseTo((150_000 * 2.5 + 9_200 * 10) / 1_000_000, 12)
  })
})

describe('gaugeLevel', () => {
  const budget = 100

  it('is ok below amber threshold', () => {
    expect(gaugeLevel(0, budget)).toBe('ok')
    expect(gaugeLevel(69.99, budget)).toBe('ok')
  })

  it('turns amber at exactly 70% (boundary)', () => {
    expect(gaugeLevel(budget * GAUGE_THRESHOLDS.amber, budget)).toBe('amber')
    expect(gaugeLevel(85, budget)).toBe('amber')
  })

  it('turns red at exactly 90% (boundary)', () => {
    expect(gaugeLevel(budget * GAUGE_THRESHOLDS.red, budget)).toBe('red')
    expect(gaugeLevel(120, budget)).toBe('red')
  })

  it('treats a non-positive budget as ok (no divide-by-zero blowup)', () => {
    expect(gaugeLevel(50, 0)).toBe('ok')
    expect(gaugeLevel(50, -5)).toBe('ok')
  })
})

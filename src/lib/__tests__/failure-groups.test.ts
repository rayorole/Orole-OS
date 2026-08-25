import { describe, expect, it } from 'vitest'

import type { RunRecord } from '#/lib/activity-feed'
import {
  errorSignature,
  groupFailedRuns,
  normalizeErrorMessage,
  signatureHash,
} from '#/lib/failure-groups'

function run(overrides: Partial<RunRecord> & { id: string }): RunRecord {
  return {
    status: 'failed',
    startedAt: 1000,
    endedAt: 2000,
    summary: `task ${overrides.id}`,
    ...overrides,
  }
}

describe('normalizeErrorMessage', () => {
  it('collapses volatile numbers so equivalent failures share a signature', () => {
    const a = normalizeErrorMessage('Timeout after 30s waiting for tool')
    const b = normalizeErrorMessage('timeout after 45s waiting for tool')
    expect(errorSignature(a)).toBe(errorSignature(b))
  })

  it('collapses UUIDs, quoted strings and paths', () => {
    const a = errorSignature('Request /api/v1/runs/8f2c1c9e-1234-4abc-9def-001122334455 failed with "rate limit"')
    const b = errorSignature('request /api/v1/runs/deadbeef-9876-4xyz-b000-998877665544 failed with "too many requests"')
    // Same structure: path + quoted-string placeholders collapse together.
    expect(a).toBe(b)
    const c = errorSignature('run 111 failed with "boom"')
    const d = errorSignature('RUN 222 FAILED WITH "BOOM"')
    expect(c).toBe(d)
    const e = errorSignature('run 111 failed while opening socket')
    expect(c).not.toBe(e) // genuinely different failure shape stays distinct
  })

  it('is stable and deterministic', () => {
    const msg = 'ECONNRESET while streaming tokens (attempt 3)'
    expect(signatureHash(normalizeErrorMessage(msg))).toBe(
      signatureHash(normalizeErrorMessage(msg)),
    )
  })
})

describe('groupFailedRuns', () => {
  it('groups only failed runs by signature, ignoring completed/running', () => {
    const groups = groupFailedRuns([
      run({ id: 'a', error: 'timeout after 10s' }),
      run({ id: 'b', error: 'timeout after 20s', endedAt: 3000 }),
      run({ id: 'ok', status: 'completed' }),
      run({ id: 'live', status: 'running', endedAt: null }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].count).toBe(2)
    expect(groups[0].runIds.sort()).toEqual(['a', 'b'])
    expect(groups[0].lastOccurredAt).toBe(3000)
  })

  it('keeps genuinely different errors in separate groups', () => {
    const groups = groupFailedRuns([
      run({ id: 'a', error: 'network unreachable' }),
      run({ id: 'b', error: 'invalid api key' }),
    ])
    expect(groups).toHaveLength(2)
  })

  it('sorts by count descending, then by recency', () => {
    const groups = groupFailedRuns([
      run({ id: 'once', error: 'flaky one-off', endedAt: 9000 }),
      run({ id: 'x1', error: 'repeated failure', endedAt: 4000 }),
      run({ id: 'x2', error: 'repeated failure', endedAt: 5000 }),
      run({ id: 'x3', error: 'REPEATED, FAILURE!', endedAt: 6000 }),
    ])
    expect(groups[0].count).toBe(3)
    expect(groups[0].lastOccurredAt).toBe(6000)
    expect(groups[1].count).toBe(1)
  })

  it('uses a fallback message for failures without detail', () => {
    const groups = groupFailedRuns([
      run({ id: 'a' }),
      run({ id: 'b', endedAt: 2500 }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].sampleMessage).toBe('(no detail provided)')
    expect(groups[0].signature).toBe(errorSignature('(no detail provided)'))
  })

  it('returns empty for zero failures', () => {
    expect(groupFailedRuns([])).toEqual([])
    expect(groupFailedRuns([run({ id: 'a', status: 'running', endedAt: null })])).toEqual([])
  })
})

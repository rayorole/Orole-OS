/**
 * Failure triage lite — group failed runs by normalized error signature.
 *
 * A signature is a hash of the error message after normalization: numbers,
 * UUIDs, quoted strings, paths and timestamps are collapsed so that
 * "timeout after 30s" and "timeout after 45s" share a signature while
 * genuinely different failures stay distinct.
 */

import type { RunRecord } from '#/lib/activity-feed'

export interface FailureGroup {
  /** Stable normalized-message signature hash. */
  signature: string
  /** Representative (first-seen) raw message for display. */
  sampleMessage: string
  count: number
  lastOccurredAt: number
  runIds: string[]
}

/**
 * Normalize an error message into a signature source:
 * strip volatile detail so equivalent failures collapse together.
 */
export function normalizeErrorMessage(message: string): string {
  return (
    message
      // Normalize whitespace and lowercase.
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      // Quoted strings → placeholder.
      .replace(/(["'`])(?:(?!\1).)*\1/g, '<str>')
      // URLs → scheme + host shape only.
      .replace(/\bhttps?:\/\/\S+/g, '<url>')
      // Absolute-ish paths → placeholder.
      .replace(/(?:\/[\w.-]+){2,}/g, '<path>')
      // Punctuation noise (commas, colons…) so wording variants collapse.
      .replace(/[,;:!?]+/g, ' ')
      .replace(/\b0x[0-9a-f]+\b|\b\d+(?:\.\d+)?\b/g, '<num>')
      // Number glued to a unit (30s, 5mb, 2xx) → placeholder too.
      .replace(/\b\d[\w]*/g, '<num>')
      .replace(/(?:<\w+>\s*){2,}/g, (m) => `<${m.trim().split(' ')[0]}> `)
      .replace(/\s+/g, ' ')
      .trim()
  )
}

/** FNV-1a 32-bit, hex — short, stable, dependency-free. */
export function signatureHash(normalized: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < normalized.length; i++) {
    h ^= normalized.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

export function errorSignature(message: string): string {
  return signatureHash(normalizeErrorMessage(message))
}

/** Group failed runs by error signature; groups sorted by count desc, then recency. */
export function groupFailedRuns(runs: RunRecord[]): FailureGroup[] {
  const bySignature = new Map<string, FailureGroup>()
  for (const run of runs) {
    if (run.status !== 'failed') continue
    const message = run.error ?? '(no detail provided)'
    const signature = errorSignature(message)
    let group = bySignature.get(signature)
    if (!group) {
      group = { signature, sampleMessage: message, count: 0, lastOccurredAt: 0, runIds: [] }
      bySignature.set(signature, group)
    }
    group.count += 1
    group.runIds.push(run.id)
    const at = run.endedAt ?? run.startedAt
    if (at > group.lastOccurredAt) group.lastOccurredAt = at
  }
  return [...bySignature.values()].sort(
    (a, b) => b.count - a.count || b.lastOccurredAt - a.lastOccurredAt,
  )
}

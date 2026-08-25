import { useQuery } from '@tanstack/react-query'
import { fetchSessions, fetchMessages, type HermesMessage } from '#/lib/hermes'

export type { ToolCall, TimeWindow } from './usage-aggregation'
import type { ToolCall } from './usage-aggregation'

/**
 * Pull every tool-call record reachable from session history and normalize
 * it to {name, ts} pairs for the aggregation layer. Field names confirmed
 * against the transcript client (src/lib/hermes.ts): assistant messages may
 * carry `tool_calls: [{function: {name, arguments}}, …]` and each message has
 * `created_at`.
 */
function extractCalls(messages: HermesMessage[]): ToolCall[] {
  const out: ToolCall[] = []
  for (const m of messages) {
    const ts = typeof m.created_at === 'string' ? m.created_at : ''
    if (!ts) continue
    const calls =
      Array.isArray(m.tool_calls) ? (m.tool_calls as Array<Record<string, unknown>>) : []
    for (const tc of calls) {
      const fn = (tc.function ?? {}) as Record<string, unknown>
      const name = String(fn.name ?? tc.name ?? '')
      // MCP server tools also arrive as plain names; both shapes count.
      if (name) out.push({ name, ts })
    }
  }
  return out
}

/** Load all sessions' tool-call history (client-side aggregate; no server endpoint). */
export async function loadToolCalls(): Promise<ToolCall[]> {
  const sessions = await fetchSessions()
  const results = await Promise.allSettled(
    sessions.map((s) => fetchMessages(s.id)),
  )
  return results.flatMap((r) => (r.status === 'fulfilled' ? extractCalls(r.value) : []))
}

export function useToolCalls(enabled = true) {
  return useQuery({
    queryKey: ['tool-calls'],
    queryFn: loadToolCalls,
    enabled,
    staleTime: 60_000,
  })
}

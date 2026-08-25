/**
 * Run trace inspector — build a plain render tree of prompt → tool call →
 * result per run, with per-step token counts and latency.
 *
 * Source data is the Hermes run-events SSE stream plus the session messages
 * backfill; both are reduced into `TraceNode[]` here so the component stays
 * dumb and rendering stays instant (no typing effect).
 */

export type TraceNodeKind = 'prompt' | 'assistant' | 'tool_call' | 'tool_result'

export interface TokenUsage {
  input: number
  output: number
}

export interface TraceStep {
  /** Sequence index within the run. */
  index: number
  kind: TraceNodeKind
  label: string
  /** Exact content as sent / received — no animation, verbatim. */
  content: string
  startedAt?: number
  latencyMs?: number
  tokens?: TokenUsage
  /** For tool calls: the tool name and raw JSON args. */
  toolName?: string
  toolArgsJson?: string
  error?: boolean
}

export function totalTokens(steps: TraceStep[]): TokenUsage {
  return steps.reduce<TokenUsage>(
    (acc, s) => ({
      input: acc.input + (s.tokens?.input ?? 0),
      output: acc.output + (s.tokens?.output ?? 0),
    }),
    { input: 0, output: 0 },
  )
}

export function totalLatencyMs(steps: TraceStep[]): number {
  return steps.reduce((acc, s) => acc + (s.latencyMs ?? 0), 0)
}

// ── Normalization from raw event/message payloads ───────────────────────────

export interface RawToolCall {
  id?: string | number
  type?: string
  function?: { name?: string; arguments?: string }
  name?: string
  args?: unknown
}

export interface RawRunStep {
  type?: string
  role?: string
  content?: unknown
  tool_calls?: RawToolCall[]
  tool_call_id?: string | number
  name?: string
  usage?: { prompt_tokens?: number; completion_tokens?: number }
  startedAt?: string | number
  endedAt?: string | number
}

function toMs(v: string | number | null | undefined): number | undefined {
  if (v == null) return undefined
  const ms = typeof v === 'number' ? v : Date.parse(v)
  return Number.isFinite(ms) ? ms : undefined
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((p) =>
        typeof p === 'object' && p !== null && 'text' in p
          ? String((p as Record<string, unknown>).text)
          : JSON.stringify(p),
      )
      .join('')
  }
  if (content == null) return ''
  try {
    return JSON.stringify(content, null, 2)
  } catch {
    return String(content)
  }
}

/**
 * Reduce the ordered list of raw run steps (messages / events for one run)
 * into an ordered trace. Tool results are attached under their triggering
 * tool call via tool_call_id when present.
 */
export function buildTrace(stepsIn: RawRunStep[]): TraceStep[] {
  const out: TraceStep[] = []

  for (const step of stepsIn) {
    const startedAt = toMs(step.startedAt)
    const endedAt = toMs(step.endedAt)
    const latencyMs =
      startedAt != null && endedAt != null ? Math.max(0, endedAt - startedAt) : undefined
    const usage = step.usage
    const tokens: TokenUsage | undefined = usage
      ? { input: usage.prompt_tokens ?? 0, output: usage.completion_tokens ?? 0 }
      : undefined
    const index = out.length

    const role = step.role
    if (role === 'user' || role === 'system' || step.type === 'prompt') {
      out.push({
        index,
        kind: role === 'system' ? 'prompt' : 'prompt',
        label: role === 'system' ? 'system prompt' : 'user prompt',
        content: contentToText(step.content),
        startedAt,
        latencyMs,
        tokens,
      })
      continue
    }

    if (role === 'assistant' || step.type === 'assistant') {
      if (step.content != null && contentToText(step.content)) {
        out.push({
          index,
          kind: 'assistant',
          label: 'assistant',
          content: contentToText(step.content),
          startedAt,
          latencyMs,
          tokens,
        })
      }
      for (const tc of step.tool_calls ?? []) {
        const fn = tc.function ?? {}
        const argsRaw = fn.arguments ?? (tc.args != null ? JSON.stringify(tc.args) : '')
        let pretty = argsRaw
        try {
          pretty = JSON.stringify(JSON.parse(String(argsRaw)), null, 2)
        } catch {
          /* keep raw */
        }
        out.push({
          index: out.length,
          kind: 'tool_call',
          label: fn.name ?? tc.name ?? 'tool',
          content: pretty,
          startedAt,
          latencyMs,
          tokens,
          toolName: fn.name ?? tc.name ?? 'tool',
          toolArgsJson: pretty,
        })
      }
      continue
    }

    if (role === 'tool' || step.type === 'tool_result' || step.tool_call_id != null) {
      out.push({
        index,
        kind: 'tool_result',
        label: `result${step.name ? ` · ${step.name}` : ''}`,
        content: contentToText(step.content),
        startedAt,
        latencyMs,
        tokens,
        error: false,
      })
      continue
    }

    // Unknown shape: keep it visible rather than silently dropping data.
    out.push({
      index,
      kind: 'assistant',
      label: step.type ?? 'event',
      content: contentToText(step.content),
      startedAt,
      latencyMs,
      tokens,
    })
  }
  return out
}

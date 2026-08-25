import { describe, expect, it } from 'vitest'

import { buildTrace, totalLatencyMs, totalTokens, type RawRunStep } from '#/lib/run-trace'

const steps: RawRunStep[] = [
  {
    role: 'user',
    content: 'list files in /tmp',
    startedAt: 1000,
    endedAt: 1010,
    usage: { prompt_tokens: 120, completion_tokens: 0 },
  },
  {
    role: 'assistant',
    content: 'I will list the files.',
    tool_calls: [
      {
        function: { name: 'terminal', arguments: '{"command":"ls /tmp"}' },
      },
    ],
    startedAt: 1020,
    endedAt: 1080,
    usage: { prompt_tokens: 130, completion_tokens: 24 },
  },
  {
    role: 'tool',
    name: 'terminal',
    tool_call_id: 1,
    content: 'a.txt\nb.log',
    startedAt: 1090,
    endedAt: 1150,
  },
]

describe('buildTrace', () => {
  it('produces prompt → assistant/tool_call → tool_result in order', () => {
    const trace = buildTrace(steps)
    expect(trace.map((s) => s.kind)).toEqual([
      'prompt',
      'assistant',
      'tool_call',
      'tool_result',
    ])
    const call = trace[2]
    expect(call.toolName).toBe('terminal')
    // Exact args as sent — pretty-printed but verbatim values.
    expect(JSON.parse(call.toolArgsJson ?? '{}')).toEqual({ command: 'ls /tmp' })
    expect(trace[3].content).toBe('a.txt\nb.log')
  })

  it('keeps per-step token counts and latency', () => {
    const trace = buildTrace(steps)
    expect(trace[0].tokens).toEqual({ input: 120, output: 0 })
    expect(trace[1].tokens).toEqual({ input: 130, output: 24 })
    expect(trace[1].latencyMs).toBe(60)
    expect(totalTokens(trace)).toEqual({ input: 380, output: 48 })
    expect(totalLatencyMs(trace)).toBe(70 + 60 + 60)
  })

  it('handles ISO timestamps and missing fields gracefully', () => {
    const trace = buildTrace([
      { type: 'prompt', content: 'hi', startedAt: '1970-01-01T00:00:01.000Z' },
      { type: 'unknown_thing', content: null },
    ])
    expect(trace[0].kind).toBe('prompt')
    expect(trace[0].latencyMs).toBeUndefined()
    expect(trace).toHaveLength(2) // unknown shapes stay visible
  })
})

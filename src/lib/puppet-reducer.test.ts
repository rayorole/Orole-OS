import { describe, it, expect } from 'vitest'
import {
  initReducerState,
  reducePuppetEvent,
  reducePuppetEvents,
  eventId,
  applyRunEvent,
  summarizeArgs,
  type PuppetEvent,
  type TranscriptEntry,
} from './puppet-reducer'

function ev(event: string, data: Record<string, unknown>, id?: string): PuppetEvent {
  return { event, data, id }
}

describe('eventId', () => {
  it('prefers the SSE id field', () => {
    expect(eventId(ev('assistant.delta', { id: 'e9', text: 'a' }, 'sse-1'))).toBe('id:sse-1')
  })
  it('falls back to data.id when no SSE id', () => {
    expect(eventId(ev('assistant.delta', { id: 'e9' }))).toBe('id:e9')
  })
  it('derives a positional fallback for id-less events', () => {
    const a = eventId(ev('assistant.delta', { text: 'hi' }))
    const b = eventId(ev('assistant.delta', { text: 'ho' }))
    expect(a).not.toBe(b)
    expect(a.startsWith('pos:')).toBe(true)
  })
})

describe('reducePuppetEvent — typing deltas', () => {
  it('appends char-by-char deltas to a growing assistant bubble', () => {
    let s = initReducerState()
    s = reducePuppetEvent(s, ev('assistant.delta', { text: 'He' }, '1'))
    s = reducePuppetEvent(s, ev('assistant.delta', { text: 'll' }, '2'))
    s = reducePuppetEvent(s, ev('assistant.delta', { text: 'o' }, '3'))
    expect(s.entries).toHaveLength(1)
    expect(s.entries[0].text).toBe('Hello')
    expect(s.entries[0].kind).toBe('assistant')
    expect(s.entries[0].streaming).toBe(true)
  })

  it('seals streaming bubble on run.completed', () => {
    let s = initReducerState()
    s = reducePuppetEvent(s, ev('assistant.delta', { text: 'x' }, '1'))
    s = reducePuppetEvent(s, ev('run.completed', {}, '2'))
    expect(s.entries[0].streaming).toBe(false)
  })

  it('ignores empty deltas without creating entries', () => {
    let s = initReducerState()
    const before = JSON.stringify(s.entries)
    s = reducePuppetEvent(s, ev('assistant.delta', { text: '' }, '1'))
    expect(JSON.stringify(s.entries)).toBe(before)
  })
})

describe('reducePuppetEvent — idempotency (reconnect dedup)', () => {
  it('drops duplicate event ids entirely', () => {
    let s = initReducerState()
    s = reducePuppetEvent(s, ev('assistant.delta', { text: 'abc' }, 'e1'))
    const snapshot = JSON.stringify(s.entries)
    // Server replays the same event after reconnect.
    const again = reducePuppetEvent(s, ev('assistant.delta', { text: 'abc' }, 'e1'))
    expect(JSON.stringify(again.entries)).toBe(snapshot)
    expect(again.entries).toHaveLength(1)
    expect(again.entries[0].text).toBe('abc')
  })

  it('survives an interleaved reconnect replay of several events', () => {
    const batch = [
      ev('run.started', { status: 'running' }, 'r1'),
      ev('assistant.delta', { text: 'one ' }, 'd1'),
      ev('assistant.delta', { text: 'two' }, 'd2'),
      ev('tool.started', { tool: 'terminal', args: { command: 'ls' } }, 't1'),
      ev('tool.completed', { tool: 'terminal', output: 'a\nb' }, 't2'),
      ev('run.completed', {}, 'r2'),
    ]
    // First pass: live tail drops mid-stream, then reconnect replays ALL.
    // Compare only text-bearing kinds — replayed-but-new events (tool chips,
    // lifecycle) are legitimately appended; the guarantee under test is that
    // no already-seen event duplicates content.
    const texts = (st: ReturnType<typeof initReducerState>) =>
      JSON.stringify(st.entries.filter((e) => e.kind === 'assistant').map((e) => e.text))
    let s = reducePuppetEvents(initReducerState(), batch.slice(0, 3))
    const afterLive = texts(s)
    s = reducePuppetEvents(s, batch) // full replay
    expect(texts(s)).toBe(afterLive)
  })

  it('dedups data.id even without SSE-level ids', () => {
    let s = initReducerState()
    s = reducePuppetEvent(s, ev('tool.started', { tool: 'read', args: {}, id: 42 }))
    const before = JSON.stringify(s.entries)
    s = reducePuppetEvent(s, ev('tool.started', { tool: 'read', args: {}, id: 42 }))
    expect(JSON.stringify(s.entries)).toBe(before)
  })
})

describe('reducePuppetEvent — tool chips', () => {
  function lastTool(entries: TranscriptEntry[]) {
    return entries[entries.length - 1].tool
  }

  it('creates running chip with summarized args + full input JSON', () => {
    const s = reducePuppetEvents(
      initReducerState(),
      [ev('tool.started', { tool: 'terminal', args: { command: 'pnpm test' } }, '1')],
    )
    expect(s.entries).toHaveLength(1)
    const t = lastTool(s.entries)!
    expect(t.name).toBe('terminal')
    expect(t.argsSummary).toContain('$ pnpm test')
    expect(t.status).toBe('running')
    expect(t.inputJson).toBe(JSON.stringify({ command: 'pnpm test' }, null, 2))
  })

  it('completes matching running chip and stores output JSON', () => {
    let s = reducePuppetEvents(
      initReducerState(),
      [
        ev('tool.started', { tool: 'read', args: { path: '/x' } }, '1'),
        ev('tool.completed', { tool: 'read', result: { lines: 10 } }, '2'),
      ],
    )
    const t = lastTool(s.entries)!
    expect(t.status).toBe('ok')
    expect(JSON.parse(t.outputJson!)).toEqual({ lines: 10 })
  })

  it('marks error status on ok:false / failed status', () => {
    let s = reducePuppetEvents(
      initReducerState(),
      [
        ev('tool.started', { tool: 'bash', args: {} }, '1'),
        ev('tool.completed', { tool: 'bash', ok: false, output: 'boom' }, '2'),
      ],
    )
    expect(lastTool(s.entries)!.status).toBe('error')

    s = reducePuppetEvents(
      initReducerState(),
      [
        ev('tool.started', { tool: 'bash', args: {} }, '3'),
        ev('tool.completed', { tool: 'bash', status: 'failed', output: 'nope' }, '4'),
      ],
    )
    expect(lastTool(s.entries)!.status).toBe('error')
  })

  it('orphan tool.completed creates its own chip', () => {
    const s = reducePuppetEvents(
      initReducerState(),
      [ev('tool.completed', { tool: 'late', output: 'done' }, '1')],
    )
    const t = lastTool(s.entries)!
    expect(t.name).toBe('late')
    expect(t.status).toBe('ok')
  })
})

describe('applyRunEvent (direct fold, shared with #12 semantics)', () => {
  it('is pure: does not mutate input array', () => {
    const prev: TranscriptEntry[] = [{ key: 'k', kind: 'assistant', text: 'a', streaming: true }]
    applyRunEvent(prev, 'assistant.delta', { text: 'b' })
    expect(prev[0].text).toBe('a')
  })

  it('unknown events are no-ops', () => {
    const prev: TranscriptEntry[] = []
    expect(applyRunEvent(prev, 'mystery.event', { x: 1 })).toBe(prev)
  })
})

describe('summarizeArgs', () => {
  it('renders commands and paths', () => {
    expect(summarizeArgs({ command: 'ls -la', path: '/tmp' })).toContain('$ ls -la')
    expect(summarizeArgs({ path: '/tmp/x.ts' })).toContain('/tmp/x.ts')
  })
  it('falls back to key=value pairs', () => {
    expect(summarizeArgs({ foo: 'bar' })).toContain('foo=bar')
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { VoiceEngine } from '../voice-engine'

type ResultHandler = (ev: {
  resultIndex: number
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>
}) => void

class FakeRecognition {
  lang = ''
  continuous = false
  interimResults = false
  started = false
  onresult: ResultHandler | null = null
  onerror: ((ev: { error: string }) => void) | null = null
  onend: (() => void) | null = null
  start() {
    this.started = true
  }
  stop() {
    this.started = false
    queueMicrotask(() => this.onend?.())
  }
  abort() {
    this.started = false
  }
}

let fakes: FakeRecognition[] = []
const lastFake = () => fakes[fakes.length - 1]

function installStt(tts = true) {
  ;(globalThis as unknown as Record<string, unknown>).SpeechRecognition = class extends FakeRecognition {
    constructor() {
      super()
      fakes.push(this)
    }
  }
  if (tts) {
    Object.defineProperty(globalThis, 'speechSynthesis', {
      configurable: true,
      value: { cancel: vi.fn(), speak: vi.fn(), pending: 0, speaking: false },
    })
  }
}

function makeEngine(overrides?: Partial<ConstructorParameters<typeof VoiceEngine>[0]>) {
  return new VoiceEngine({
    sendUtterance: vi.fn(async (text: string) => `echo:${text}`),
    onState: vi.fn(),
    onTranscript: vi.fn(),
    onReply: vi.fn(),
    ...overrides,
  })
}

beforeEach(() => {
  fakes = []
})

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).SpeechRecognition
  delete (globalThis as unknown as Record<string, unknown>).webkitSpeechRecognition
  // @ts-expect-error test cleanup of the injected global
  delete globalThis.speechSynthesis
})

describe('VoiceEngine', () => {
  it('reports graceful degradation when SpeechRecognition is missing', () => {
    // No STT global installed at all
    const engine = makeEngine()
    expect(engine.support.stt).toBe(false)
    expect(() => engine.startListening()).toThrow(/not available|not supported/i)
    expect(engine.state).toBe('error')
  })

  it('moves idle -> listening on start', () => {
    installStt()
    const engine = makeEngine()
    engine.startListening()
    expect(engine.state).toBe('listening')
    expect(lastFake().started).toBe(true)
  })

  it('runs the full round trip: transcript -> thinking -> reply -> idle', async () => {
    installStt(/* tts */ false) // skip speechSynthesis so speak() resolves immediately
    const opts = {
      sendUtterance: vi.fn(async (t: string) => `reply to ${t}`),
      onState: vi.fn(),
      onTranscript: vi.fn(),
      onReply: vi.fn(),
    }
    const engine = new VoiceEngine(opts)
    engine.startListening()

    lastFake().onresult?.({
      resultIndex: 0,
      results: [{ 0: { transcript: 'status report' }, isFinal: true, length: 1 }],
    })
    engine.stopListening()
    await vi.waitFor(() => expect(opts.onReply).toHaveBeenCalledWith('reply to status report'))
    expect(opts.sendUtterance).toHaveBeenCalledWith('status report')
    await vi.waitFor(() => expect(engine.state).toBe('idle'))
    const states = opts.onState.mock.calls.map((c) => c[0])
    expect(states).toContain('listening')
    expect(states.indexOf('thinking')).toBeGreaterThan(states.indexOf('listening'))
  })

  it('drops back to idle when nothing was heard', async () => {
    installStt()
    const opts = { sendUtterance: vi.fn(), onState: vi.fn(), onTranscript: vi.fn(), onReply: vi.fn() }
    const engine = new VoiceEngine(opts)
    engine.startListening()
    engine.stopListening()
    await vi.waitFor(() => expect(engine.state).toBe('idle'))
    expect(opts.sendUtterance).not.toHaveBeenCalled()
  })

  it('surfaces mic permission denial as an error state', async () => {
    installStt()
    const opts = { sendUtterance: vi.fn(), onState: vi.fn(), onTranscript: vi.fn(), onReply: vi.fn() }
    const engine = new VoiceEngine(opts)
    engine.startListening()
    lastFake().onerror?.({ error: 'not-allowed' })
    await vi.waitFor(() =>
      expect(String(opts.onState.mock.calls.at(-1)?.[1])).toMatch(/microphone/i),
    )
    expect(engine.state).toBe('error')
  })

  it('marks thinking then error when the agent round-trip fails', async () => {
    installStt()
    const opts = {
      sendUtterance: vi.fn(async () => {
        throw new Error('gateway down')
      }),
      onState: vi.fn(),
      onTranscript: vi.fn(),
      onReply: vi.fn(),
    }
    const engine = new VoiceEngine(opts)
    engine.startListening()
    lastFake().onresult?.({
      resultIndex: 0,
      results: [{ 0: { transcript: 'hi' }, isFinal: true, length: 1 }],
    })
    engine.stopListening()
    await vi.waitFor(() => expect(engine.state).toBe('error'))
    expect(opts.onState.mock.calls.some((c) => c[0] === 'thinking')).toBe(true)
    expect(opts.onState).toHaveBeenLastCalledWith('error', 'gateway down')
  })
})

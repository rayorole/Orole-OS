/**
 * Voice engine — Web Speech API STT + TTS with an ambient state machine.
 *
 * Transport-agnostic by design: the caller supplies `sendUtterance`, which
 * transmits the transcript to the active agent session and resolves with the
 * assistant reply text. This seam keeps the engine testable without network.
 */

import {
  micPermission,
  speechSupport,
  type SpeechSupport,
  type VoiceAmbientState,
} from './voice-state'

export interface VoiceEngineOptions {
  /** Send a user utterance to the agent; resolves with the reply text. */
  sendUtterance: (text: string) => Promise<string>
  onState: (state: VoiceAmbientState, detail?: string) => void
  onTranscript: (text: string, final: boolean) => void
  onReply: (text: string) => void
}

interface RecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  abort(): void
  onresult:
    | ((
        ev: {
          resultIndex: number
          results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>
        },
      ) => void)
    | null
  onerror: ((ev: { error: string }) => void) | null
  onend: (() => void) | null
}

type RecognitionCtor = new () => RecognitionLike

function getRecognitionCtor(): RecognitionCtor | null {
  const g = (
    typeof window !== 'undefined' ? window : globalThis
  ) as unknown as Record<string, unknown>
  if (!g) return null
  return (g.SpeechRecognition ?? g.webkitSpeechRecognition) as RecognitionCtor | null
}

export class MicPermissionDeniedError extends Error {
  constructor() {
    super('Microphone permission denied')
    this.name = 'MicPermissionDeniedError'
  }
}

export class SpeechUnavailableError extends Error {
  constructor() {
    super('Speech recognition is not available in this browser')
    this.name = 'SpeechUnavailableError'
  }
}

export class VoiceEngine {
  private opts: VoiceEngineOptions
  private recognition: RecognitionLike | null = null
  private finalTranscript = ''
  private busy = false // a round-trip is in flight
  support: SpeechSupport

  constructor(opts: VoiceEngineOptions) {
    this.opts = opts
    this.support = speechSupport()
  }

  get state(): VoiceAmbientState {
    return this._state
  }
  private _state: VoiceAmbientState = 'idle'

  private setState(s: VoiceAmbientState, detail?: string) {
    this._state = s
    this.opts.onState(s, detail)
  }

  async checkPermission(): Promise<PermissionState | 'unsupported'> {
    return micPermission()
  }

  /** Begin a listening turn. Safe to call repeatedly while active. */
  startListening(): void {
    if (!this.support.stt) {
      this.setState('error', 'Speech recognition is not supported — use the text fallback below.')
      throw new SpeechUnavailableError()
    }
    if (this.recognition || this.busy) return

    const Ctor = getRecognitionCtor()!
    const rec = new Ctor()
    rec.lang = navigator.language || 'en-US'
    rec.continuous = true
    rec.interimResults = true
    this.finalTranscript = ''

    rec.onresult = (ev) => {
      let interim = ''
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i]
        if (res.isFinal) this.finalTranscript += res[0].transcript + ' '
        else interim += res[0].transcript
      }
      this.opts.onTranscript((this.finalTranscript + interim).trim(), false)
    }

    rec.onerror = (ev) => {
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
        this.setState('error', 'Microphone blocked. Enable mic access for this site and try again.')
        this.recognition = null
        return
      }
      if (ev.error === 'no-speech') return // silent end-of-turn, handled by stop()
      if (ev.error !== 'aborted') {
        this.setState('error', `Speech recognition error: ${ev.error}`)
      }
    }

    rec.onend = () => {
      this.recognition = null
      const utterance = this.finalTranscript.trim()
      if (!utterance) {
        this.setState('idle')
        return
      }
      void this.runRoundTrip(utterance)
    }

    this.recognition = rec
    try {
      rec.start()
      this.setState('listening')
    } catch {
      this.recognition = null
    }
  }

  /**
   * End a listening turn: finalize whatever was heard and run the round-trip.
   * If nothing was captured we simply drop back to idle.
   */
  stopListening(): void {
    if (!this.recognition) return
    try {
      this.recognition.stop() // triggers onend -> round trip
    } catch {
      this.recognition = null
      const utterance = this.finalTranscript.trim()
      if (!utterance) {
        this.setState('idle')
        return
      }
      void this.runRoundTrip(utterance)
    }
  }

  private async runRoundTrip(utterance: string): Promise<void> {
    this.busy = true
    this.setState('thinking')
    this.opts.onTranscript(utterance, true)
    try {
      const reply = await this.opts.sendUtterance(utterance)
      this.opts.onReply(reply)
      await this.speak(reply)
      this.setState('idle')
    } catch (err) {
      this.setState(
        'error',
        err instanceof Error ? err.message : 'The agent could not be reached.',
      )
    } finally {
      this.busy = false
    }
  }

  /** Speak a reply aloud via speechSynthesis. Resolves when done or unsupported. */
  speak(text: string): Promise<void> {
    if (!this.support.tts || !text) return Promise.resolve()
    return new Promise((resolve) => {
      const synth = window.speechSynthesis
      synth.cancel()
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.rate = 1.05
      let done = false
      const finish = () => {
        if (!done) {
          done = true
          resolve()
        }
      }
      utterance.onstart = () => this.setState('speaking')
      utterance.onend = finish
      utterance.onerror = finish
      // Safety resolve in case events never fire
      setTimeout(finish, Math.min(30_000, 1500 + text.length * 120))
      synth.speak(utterance)
    })
  }

  stopSpeaking(): void {
    if (this.support.tts) window.speechSynthesis.cancel()
  }

  /** Abort everything (overlay closed mid-turn). */
  abort(): void {
    this.stopSpeaking()
    try {
      this.recognition?.abort()
    } catch {
      /* noop */
    }
    this.recognition = null
    if (!this.busy) this.setState('idle')
  }
}

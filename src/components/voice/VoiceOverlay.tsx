import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Canvas } from '@react-three/fiber'
import { Mic, MicOff, Square, Volume2, VolumeX, X, Keyboard } from 'lucide-react'

import { VoiceEngine } from '#/lib/voice-engine'
import { speechSupport, type VoiceAmbientState } from '#/lib/voice-state'
import { CoreReactor } from './CoreReactor'

const HOTKEY = 'v' // Ctrl/Cmd + Shift + V toggles the overlay

const STATE_LABEL: Record<VoiceAmbientState, string> = {
  idle: 'Ready — hold the mic and speak',
  listening: 'Listening…',
  thinking: 'Thinking…',
  speaking: 'Speaking…',
  error: 'Something went wrong',
}

interface TranscriptEntry {
  role: 'user' | 'assistant'
  text: string
}

/**
 * Send the transcribed utterance to the active agent session chat.
 * Uses the Hermes gateway chat completions endpoint.
 */
async function sendUtterance(text: string): Promise<string> {
  const base = (import.meta.env.VITE_HERMES_API_URL as string | undefined) ?? ''
  if (!base) {
    throw new Error('No agent gateway configured — set VITE_HERMES_API_URL.')
  }
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: text }] }),
  })
  if (!res.ok) throw new Error(`Agent request failed (${res.status})`)
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const reply = data.choices?.[0]?.message?.content
  if (!reply) throw new Error('The agent returned an empty response.')
  return reply
}

export function VoiceOverlay() {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<VoiceAmbientState>('idle')
  const [detail, setDetail] = useState<string | undefined>()
  const [liveTranscript, setLiveTranscript] = useState('')
  const [entries, setEntries] = useState<TranscriptEntry[]>([])
  const [ttsEnabled, setTtsEnabled] = useState(() => {
    if (typeof localStorage === 'undefined') return true
    return localStorage.getItem('orole.voice.tts') !== 'off'
  })

  const engineRef = useRef<VoiceEngine | null>(null)
  const support = useMemo(speechSupport, [])
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    engineRef.current = new VoiceEngine({
      sendUtterance,
      onState: (s, d) => {
        setState(s)
        setDetail(d)
      },
      onTranscript: (text, final) => {
        setLiveTranscript(final ? '' : text)
        if (final && text) {
          setEntries((prev) => [...prev.slice(-20), { role: 'user', text }])
        }
      },
      onReply: (text) => {
        setEntries((prev) => [...prev.slice(-20), { role: 'assistant', text }])
      },
    })
  }, [])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [entries, liveTranscript])

  const toggleOverlay = useCallback(() => {
    setOpen((v) => !v)
  }, [])

  // Global hotkey: Ctrl/Cmd+Shift+V opens/closes the overlay from any route.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === HOTKEY) {
        e.preventDefault()
        toggleOverlay()
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleOverlay])

  useEffect(() => {
    if (!open) engineRef.current?.abort()
  }, [open])

  const holdStart = useCallback(() => {
    try {
      engineRef.current?.startListening()
    } catch {
      /* state already reflects the unsupported case */
    }
  }, [])

  const holdEnd = useCallback(() => {
    engineRef.current?.stopListening()
  }, [])

  const toggleTts = useCallback(() => {
    setTtsEnabled((on) => {
      const next = !on
      localStorage.setItem('orole.voice.tts', next ? 'on' : 'off')
      if (!next) engineRef.current?.stopSpeaking()
      else void engineRef.current?.speak('Voice replies enabled.')
      return next
    })
  }, [])

  const micDenied = state === 'error' && /microphone|mic access/i.test(detail ?? '')
  const unsupported = !support.stt

  return (
    <>
      {/* Persistent mic button — reachable from every route */}
      <button
        type="button"
        onClick={toggleOverlay}
        aria-label="Open voice assistant"
        className={`fixed bottom-5 right-5 z-50 grid size-14 place-items-center rounded-full border shadow-[0_0_24px_var(--grid-glow)] backdrop-blur transition-transform hover:scale-105 ${
          open
            ? 'border-neon-cyan/60 bg-neon-cyan/15 text-neon-cyan'
            : 'border-border bg-card/80 text-foreground'
        }`}
      >
        <Mic className="size-6" />
        {!open && (
          <span className="absolute inset-0 animate-ping rounded-full border border-neon-cyan/30" />
        )}
      </button>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-md"
            role="dialog"
            aria-modal="true"
            aria-label="Voice assistant"
            onClick={(e) => {
              if (e.target === e.currentTarget) setOpen(false)
            }}
          >
            <div className="relative flex h-[min(88vh,760px)] w-[min(94vw,880px)] flex-col overflow-hidden rounded-3xl border border-neon-cyan/25 bg-card/70 shadow-[0_0_64px_var(--grid-glow)]">
              {/* HUD header */}
              <div className="flex items-center justify-between border-b border-border/60 px-5 py-3">
                <div className="flex items-center gap-3">
                  <span
                    className={`size-2.5 rounded-full transition-colors ${
                      state === 'listening'
                        ? 'bg-cyan-300 shadow-[0_0_10px_#67e8f9]'
                        : state === 'thinking'
                          ? 'bg-violet-400 shadow-[0_0_10px_#a78bfa]'
                          : state === 'speaking'
                            ? 'bg-teal-300 shadow-[0_0_10px_#5eead4]'
                            : state === 'error'
                              ? 'bg-rose-400 shadow-[0_0_10px_#fb7185]'
                              : 'bg-emerald-400/70'
                    }`}
                  />
                  <span className="font-mono text-xs uppercase tracking-[0.3em] text-muted-foreground">
                    jarvis · {state}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={toggleTts}
                    aria-label={ttsEnabled ? 'Mute voice replies' : 'Unmute voice replies'}
                    aria-pressed={ttsEnabled}
                    title={ttsEnabled ? 'Mute voice replies' : 'Speak replies aloud'}
                    className="rounded-lg p-2 text-muted-foreground transition hover:bg-accent hover:text-foreground"
                  >
                    {ttsEnabled ? (
                      <Volume2 className="size-4" />
                    ) : (
                      <VolumeX className="size-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label="Close voice overlay"
                    className="rounded-lg p-2 text-muted-foreground transition hover:bg-accent hover:text-foreground"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              </div>

              {/* Core + transcript */}
              <div className="flex min-h-0 flex-1">
                <div className="relative hidden w-[46%] shrink-0 sm:block">
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,rgba(34,211,238,0.12),transparent_65%)]" />
                  <Suspense fallback={null}>
                    <Canvas camera={{ position: [0, 0, 5.5], fov: 50 }} gl={{ alpha: true }}>
                      <CoreReactor state={state} />
                    </Canvas>
                  </Suspense>
                </div>

                <div className="flex min-w-0 flex-1 flex-col border-l border-border/50">
                  <div
                    ref={logRef}
                    className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4"
                  >
                    {entries.length === 0 && !liveTranscript && (
                      <div className="mt-10 text-center text-sm text-muted-foreground">
                        <p className="mb-1 font-mono uppercase tracking-[0.25em] text-neon-cyan/70">
                          voice-first interface
                        </p>
                        <p>Hold the mic button and speak. Release to send.</p>
                        <p className="mt-4 inline-flex items-center gap-1.5 text-xs">
                          <Keyboard className="size-3.5" />
                          or press{' '}
                          <kbd className="rounded border px-1 font-mono">Ctrl</kbd>+
                          <kbd className="rounded border px-1 font-mono">Shift</kbd>+
                          <kbd className="rounded border px-1 font-mono">V</kbd> anytime
                        </p>
                      </div>
                    )}
                    {entries.map((e, i) => (
                      <div key={i} className="space-y-1">
                        <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                          {e.role === 'user' ? 'you' : 'jarvis'}
                        </span>
                        <p
                          className={`rounded-xl border px-3 py-2 text-sm leading-relaxed ${
                            e.role === 'user'
                              ? 'border-border/60 bg-muted/40'
                              : 'border-neon-cyan/25 bg-neon-cyan/5'
                          }`}
                        >
                          {e.text}
                        </p>
                      </div>
                    ))}
                    {liveTranscript && (
                      <p className="animate-pulse rounded-xl border border-dashed border-neon-cyan/40 px-3 py-2 text-sm italic text-neon-cyan/90">
                        {liveTranscript}…
                      </p>
                    )}
                  </div>

                  {/* Push-to-talk bar */}
                  <div className="border-t border-border/50 px-5 py-4">
                    {unsupported ? (
                      <UnsupportedNotice />
                    ) : micDenied ? (
                      <PermissionNotice detail={detail} />
                    ) : (
                      <PushToTalkBar
                        state={state}
                        label={STATE_LABEL[state]}
                        onDown={holdStart}
                        onUp={holdEnd}
                      />
                    )}
                    {state === 'error' && !micDenied && detail && (
                      <p role="alert" className="mt-2 text-xs text-destructive">
                        {detail}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}

function PushToTalkBar({
  state,
  label,
  onDown,
  onUp,
}: {
  state: VoiceAmbientState
  label: string
  onDown: () => void
  onUp: () => void
}) {
  const listening = state === 'listening'
  const busy = state === 'thinking' || state === 'speaking'
  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        aria-label={listening ? 'Release to send' : 'Hold to talk'}
        disabled={busy}
        onPointerDown={onDown}
        onPointerUp={onUp}
        onPointerLeave={() => listening && onUp()}
        className={`grid size-12 shrink-0 place-items-center rounded-full border transition-all ${
          listening
            ? 'scale-110 border-neon-cyan bg-neon-cyan/20 text-neon-cyan shadow-[0_0_28px_rgba(103,232,249,0.5)]'
            : busy
              ? 'cursor-wait border-border bg-muted/60 text-muted-foreground'
              : 'border-neon-cyan/40 bg-card text-foreground hover:border-neon-cyan hover:bg-neon-cyan/10'
        }`}
      >
        {listening ? (
          <Square className="size-4 fill-current" />
        ) : (
          <Mic className="size-5" />
        )}
      </button>
      <p className="font-mono text-xs uppercase tracking-[0.22em] text-muted-foreground">
        {label}
      </p>
    </div>
  )
}

function UnsupportedNotice() {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-amber-400/30 bg-amber-400/5 px-4 py-3">
      <MicOff className="mt-0.5 size-4 shrink-0 text-amber-400" />
      <div className="text-sm">
        <p className="font-medium text-amber-200">Speech recognition unavailable</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          This browser doesn&apos;t support the Web Speech API. Try Chrome or Edge,
          or use the text chat — it stays fully functional.
        </p>
      </div>
    </div>
  )
}

function PermissionNotice({ detail }: { detail?: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-rose-400/30 bg-rose-400/5 px-4 py-3">
      <MicOff className="mt-0.5 size-4 shrink-0 text-rose-400" />
      <div className="text-sm">
        <p className="font-medium text-rose-200">Microphone blocked</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {detail ?? 'Orole needs mic access to hear you.'} Click the lock/site icon in
          your browser&apos;s address bar → allow microphone → then reload.
        </p>
      </div>
    </div>
  )
}

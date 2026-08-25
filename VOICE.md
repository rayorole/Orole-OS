# Orole-OS — Voice Pipeline (ElevenLabs STT + TTS)

Push-to-talk voice loop: mic → ElevenLabs speech-to-text → Hermes chat →
ElevenLabs TTS (`eleven_turbo_v2_5`) streamed back as audio.

## Layout

- `app/server/elevenlabs.ts` — proxy handlers for `/api/elevenlabs/speech-to-text`
  and `/api/elevenlabs/tts`. Reads `ELEVENLABS_API_KEY` from the server env;
  the key never reaches the browser.
- `app/server/index.ts` — Node HTTP server: serves the built SPA from `dist/`
  with fallback, mounts the proxy routes. Run `node --experimental-strip-types server/index.ts`.
- `app/src/lib/voice.ts` — client voice loop: MediaRecorder capture, STT call,
  Hermes `/v1/chat/completions` request, TTS fetch + playback, state machine.
- `app/src/components/PushToTalk.tsx` — push-to-talk button (pointer hold +
  space bar), status label, transcript/reply display.

## Env

Copy `.env.example`. Only `ELEVENLABS_API_KEY` is server-side.

## Dev

```
cd app && npm install && npm run build
PORT=8791 node --experimental-strip-types server/index.ts
```

Verified: build passes (`tsc -b && vite build`); server serves SPA (200) and both
proxy routes return 503 with a clear error when the key is unset.

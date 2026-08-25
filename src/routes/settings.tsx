import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'

import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import {
  DEFAULT_API_BASE_URL,
  getCredentialProvider,
} from '#/lib/api-config'
import { ApiError, listModels, type ConnectionStatus } from '#/lib/api-client'

export const Route = createFileRoute('/settings')({
  component: Settings,
})

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'done'; status: ConnectionStatus; detail: string }

const STATUS_META: Record<
  ConnectionStatus | 'idle' | 'testing',
  { label: string; tone: string }
> = {
  idle: { label: 'Not tested', tone: 'text-muted-foreground' },
  testing: { label: 'Testing…', tone: 'text-neon-violet animate-pulse' },
  connected: { label: 'Connected', tone: 'text-neon-cyan' },
  unauthorized: { label: 'Unauthorized', tone: 'text-destructive' },
  'network-error': { label: 'Network / CORS error', tone: 'text-destructive' },
  'server-error': { label: 'Backend error', tone: 'text-amber-400' },
  'no-key': { label: 'No API key', tone: 'text-destructive' },
}

function Settings() {
  const provider = getCredentialProvider()
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [baseUrl, setBaseUrl] = useState(DEFAULT_API_BASE_URL)
  const [hasStoredKey, setHasStoredKey] = useState(false)
  const [test, setTest] = useState<TestState>({ kind: 'idle' })
  const [error, setError] = useState<string | null>(null)

  // Restore saved key on mount (client only — SSR-safe).
  useEffect(() => {
    const stored = provider.getCredentials().apiKey
    setApiKey(stored ?? '')
    setBaseUrl(provider.getBaseUrl())
    setHasStoredKey(Boolean(stored))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleSave() {
    setError(null)
    try {
      if (!apiKey.trim()) throw new Error('Enter an API key first.')
      provider.setBaseUrl(baseUrl)
      provider.setApiKey(apiKey)
      setHasStoredKey(true)
      setTest({ kind: 'idle' })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  function handleClear() {
    provider.clearApiKey()
    setApiKey('')
    setHasStoredKey(false)
    setTest({ kind: 'idle' })
    setError(null)
  }

  async function handleTest() {
    setError(null)
    try {
      provider.setBaseUrl(baseUrl) // make sure we test what's on screen
      if (!provider.getCredentials().apiKey && !apiKey.trim()) {
        setTest({
          kind: 'done',
          status: 'no-key',
          detail: 'Paste and save an API key before testing.',
        })
        return
      }
      if (!hasStoredKey && apiKey.trim()) provider.setApiKey(apiKey)

      setTest({ kind: 'testing' })
      await listModels()
      setTest({ kind: 'done', status: 'connected', detail: 'Backend accepted the key.' })
    } catch (e) {
      if (e instanceof ApiError) {
        setTest({ kind: 'done', status: e.status, detail: e.message })
      } else {
        setTest({ kind: 'done', status: 'network-error', detail: String(e) })
      }
    }
  }

  const meta = STATUS_META[test.kind === 'done' ? test.status : test.kind]
  const showCorsHelp = test.kind === 'done' && test.status === 'network-error'

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-16">
      <div className="space-y-2 text-center">
        <p className="font-mono text-xs uppercase tracking-[0.35em] text-neon-violet">
          credentials
        </p>
        <h1 className="bg-gradient-to-r from-neon-cyan via-foreground to-neon-violet bg-clip-text text-4xl font-bold text-transparent">
          Settings
        </h1>
        <p className="text-muted-foreground text-sm">
          Your key is stored only in this browser (localStorage) and sent
          exclusively to the backend base URL below. It is never transmitted
          anywhere else, logged, or included in error reports.
        </p>
      </div>

      {!hasStoredKey && (
        <Card className="border-neon-cyan/40 shadow-[0_0_32px_var(--grid-glow)]">
          <CardHeader>
            <CardTitle className="font-mono text-sm text-neon-cyan">
              ⬤ First-time setup required
            </CardTitle>
            <CardDescription>
              No API key is stored yet. The panel cannot talk to the backend
              until you paste one below.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <Card className="w-full border-[var(--line)]">
        <CardHeader>
          <CardTitle>API access</CardTitle>
          <CardDescription>OpenAI-compatible backend</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              API key
            </span>
            <span className="flex gap-2">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-…"
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowKey((v) => !v)}
                aria-label={showKey ? 'Hide key' : 'Show key'}
              >
                {showKey ? 'Hide' : 'Show'}
              </Button>
            </span>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              Backend base URL
            </span>
            <input
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={DEFAULT_API_BASE_URL}
              spellCheck={false}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </label>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={handleSave}>Save key</Button>
            <Button variant="outline" onClick={handleTest}>
              Test connection
            </Button>
            {hasStoredKey && (
              <Button variant="destructive" onClick={handleClear}>
                Clear stored key
              </Button>
            )}
          </div>

          {test.kind !== 'idle' && (
            <div
              role="status"
              className="flex items-center gap-2 rounded-md border border-[var(--line)] px-3 py-2 text-sm"
            >
              <span className={`font-mono font-semibold ${meta.tone}`}>
                {meta.label}
              </span>
              {test.kind === 'done' && (
                <span className="text-muted-foreground">{test.detail}</span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <CorsHelp open={showCorsHelp} />
    </main>
  )
}

export function CorsHelp({ open }: { open?: boolean }) {
  return (
    <details className="island-shell rounded-xl p-5" open={open}>
      <summary className="cursor-pointer font-mono text-sm uppercase tracking-wider text-neon-violet">
        Browser shows a network error? Check CORS
      </summary>
      <div className="mt-4 space-y-3 text-sm leading-relaxed text-muted-foreground">
        <p>
          Browsers block requests when the backend does not send the right CORS
          headers. Configure it with:
        </p>
        <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">
{`Access-Control-Allow-Origin: <your panel's exact origin>
  e.g. http://localhost:3000 or https://panel.yourdomain.com
Access-Control-Allow-Headers: Authorization, Content-Type
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Max-Age: 86400   # cache preflights for a day`}
        </pre>
        <p>
          Restrict allow-origin to your panel's own deployment origin — do{' '}
          <strong>not</strong> use <code>*</code>, because the{' '}
          <code>Authorization</code> header carries your credential. If the
          panel is served from a subdomain of the API host in production, CORS
          may not apply there, but it always matters for local dev where ports
          differ.
        </p>
      </div>
    </details>
  )
}

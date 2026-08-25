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
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Switch } from '#/components/ui/switch'
import { Badge } from '#/components/ui/badge'
import { Spinner } from '#/components/ui/spinner'
import { purgeLegacyStoredKey } from '#/lib/api-config'
import {
  checkSession,
  login,
  logout,
  type AuthStatus,
} from '#/lib/session-client'
import { ApiError, listModels } from '#/lib/api-client'

export const Route = createFileRoute('/settings')({
  component: Settings,
})

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'done'; status: string; detail: string }

const STATUS_META: Record<
  string,
  { label: string; variant: 'idle' | 'pending' | 'running' | 'failed' | 'outline' }
> = {
  idle: { label: 'Not tested', variant: 'idle' },
  testing: { label: 'Testing…', variant: 'pending' },
  connected: { label: 'Connected', variant: 'running' },
  unauthorized: { label: 'Rejected', variant: 'failed' },
  'network-error': { label: 'Network error', variant: 'failed' },
  'server-error': { label: 'Backend error', variant: 'pending' },
  'no-session': { label: 'Not signed in', variant: 'failed' },
}

function Settings() {
  const [auth, setAuth] = useState<AuthStatus>('unknown')
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [test, setTest] = useState<TestState>({ kind: 'idle' })

  useEffect(() => {
    // Security migration: wipe any key an older build stored in localStorage.
    purgeLegacyStoredKey()
    void checkSession().then(setAuth)
  }, [])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!apiKey.trim()) {
      setError('Enter your gateway API key.')
      return
    }
    setBusy(true)
    try {
      await login(apiKey.trim())
      setApiKey('') // never keep it around — not even in component state
      setAuth(await checkSession())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleLogout() {
    await logout()
    setAuth('unauthenticated')
    setTest({ kind: 'idle' })
  }

  async function handleTest() {
    setError(null)
    setTest({ kind: 'testing' })
    try {
      await listModels()
      setTest({ kind: 'done', status: 'connected', detail: 'Session is live against the gateway.' })
    } catch (e) {
      if (e instanceof ApiError) {
        setTest({ kind: 'done', status: e.status, detail: e.message })
      } else {
        setTest({ kind: 'done', status: 'network-error', detail: String(e) })
      }
    }
  }

  const meta = STATUS_META[test.kind === 'done' ? test.status : test.kind]

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-16">
      <div className="space-y-2 text-center">
        <p className="font-mono text-xs uppercase tracking-[0.35em] text-neon-violet">
          security
        </p>
        <h1 className="bg-gradient-to-r from-neon-cyan via-foreground to-neon-violet bg-clip-text text-4xl font-bold text-transparent">
          Settings
        </h1>
        <p className="text-muted-foreground text-sm">
          Your gateway key is entered once and exchanged for a secure httpOnly
          session cookie. The key itself is never stored in this browser —
          not in localStorage, cookies, or logs.
        </p>
      </div>

      {auth === 'authenticated' ? (
        <Card className="w-full border-[var(--line)]">
          <CardHeader>
            <CardTitle>Session active</CardTitle>
            <CardDescription>
              Signed in via secure httpOnly cookie. CSRF protection is enforced
              on approve/deny actions.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={handleTest}>
              Test connection
            </Button>
            <Button variant="destructive" onClick={handleLogout}>
              Sign out
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="w-full border-neon-cyan/40 shadow-[0_0_32px_var(--grid-glow)]">
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>
              Paste your Hermes gateway admin key once to start a session.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="flex flex-col gap-4" onSubmit={handleLogin}>
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor="gateway-api-key"
                  className="font-mono text-xs uppercase tracking-wider text-muted-foreground"
                >
                  Gateway API key
                </Label>
                <div className="flex items-center gap-3">
                  <Input
                    id="gateway-api-key"
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-…"
                    autoComplete="off"
                    spellCheck={false}
                    className="w-full font-mono"
                  />
                  <Label className="flex shrink-0 items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
                    <Switch
                      checked={showKey}
                      onCheckedChange={setShowKey}
                      aria-label={showKey ? 'Hide key' : 'Show key'}
                    />
                    {showKey ? 'Hide' : 'Show'}
                  </Label>
                </div>
              </div>

              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}

              <div className="flex items-center gap-2">
                <Button type="submit" disabled={busy} className="gap-2">
                  {busy && <Spinner className="size-4" />}
                  {busy ? 'Signing in…' : 'Sign in'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {test.kind !== 'idle' && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-md border border-[var(--line)] px-3 py-2 text-sm"
        >
          <Badge variant={meta.variant} className="font-mono font-semibold">
            {meta.label}
          </Badge>
          {test.kind === 'done' && (
            <span className="text-muted-foreground">{test.detail}</span>
          )}
        </div>
      )}
    </main>
  )
}

/**
 * Session-based auth client for Orole-OS (issue #32).
 *
 * The browser NEVER stores the gateway admin key. Login exchanges the key
 * (typed once) for an httpOnly session cookie; afterwards every request is
 * cookie-authenticated and mutating calls echo the CSRF double-submit token.
 */

export const CSRF_COOKIE = 'orole_csrf'
export const CSRF_HEADER = 'x-csrf-token'

/** Read the non-httpOnly CSRF cookie for the double-submit pattern. */
export function getCsrfToken(): string {
  try {
    const match = document.cookie.match(/(?:^|;\s*)orole_csrf=([^;]*)/)
    return match ? decodeURIComponent(match[1]) : ''
  } catch {
    return ''
  }
}

export type AuthStatus = 'unknown' | 'authenticated' | 'unauthenticated'

function base(): string {
  // Same-origin by default; overridable for dev via ?gateway= or localStorage base.
  return ''
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${base()}${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: {
      ...(init?.headers as Record<string, string> | undefined),
      ...(getCsrfToken() ? { [CSRF_HEADER]: getCsrfToken() } : {}),
    },
  })
}

/** Exchange the gateway key (entered once) for a session. Key is not persisted. */
export async function login(apiKey: string): Promise<void> {
  const res = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ apiKey }),
  })
  if (res.status === 401) throw new Error('The gateway rejected this key.')
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(data?.error ?? `Login failed (HTTP ${res.status}).`)
  }
}

export async function logout(): Promise<void> {
  await request('/api/auth/logout', { method: 'POST' })
}

export async function checkSession(): Promise<AuthStatus> {
  try {
    const res = await request('/api/auth/session')
    const data = (await res.json().catch(() => null)) as { authenticated?: boolean } | null
    return data?.authenticated ? 'authenticated' : 'unauthenticated'
  } catch {
    return 'unknown'
  }
}

/**
 * Authenticated SSE via fetch + ReadableStream with a bearer stream token —
 * never EventSource, so no token ever appears in a URL or access log.
 */
export async function openEventStream(
  path: string,
  onEvent: (data: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const tokRes = await request('/api/auth/stream-token')
  if (!tokRes.ok) throw new Error('Could not obtain stream token (not authenticated?).')
  const { token } = (await tokRes.json()) as { token: string }

  const res = await fetch(`${base()}${path}`, {
    headers: { Authorization: `Bearer ${token}`, accept: 'text/event-stream' },
    credentials: 'same-origin',
    signal,
  })
  if (!res.ok || !res.body) throw new Error(`Stream failed (HTTP ${res.status}).`)

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      for (const line of chunk.split('\n')) {
        if (line.startsWith('data:')) onEvent(line.slice(5).trimStart())
      }
    }
  }
}

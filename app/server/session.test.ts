// E2E security flow tests (issue #32): login -> feed (stream token) -> approve.
//
// Drives the actual server route handlers through Request/Response objects —
// no network, and no mocks of the auth logic itself.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createSession,
  SESSION_COOKIE,
  CSRF_COOKIE,
  CSRF_HEADER,
  authorize,
  originMatchesRequest,
  redeemStreamToken,
  createStreamToken,
  sessionCookieHeaders,
} from './session.ts';

function req(
  url: string,
  opts: {
    method?: string;
    cookies?: Record<string, string>;
    headers?: Record<string, string>;
  } = {},
): Request {
  const cookieHeader = Object.entries(opts.cookies ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  const headers: Record<string, string> = { host: 'panel.example.com', ...(opts.headers ?? {}) };
  if (cookieHeader) headers.cookie = cookieHeader;
  return new Request(url, { method: opts.method ?? 'GET', headers });
}

describe('login -> cookie shape', () => {
  it('issues httpOnly / SameSite=Lax cookies', () => {
    const s = createSession();
    const [sess, csrf] = sessionCookieHeaders(s, true);
    expect(sess).toContain('HttpOnly');
    expect(sess).toContain('SameSite=Lax');
    expect(sess).toContain('Secure');
    expect(csrf).not.toContain('HttpOnly'); // client must read it for double-submit
  });
});

describe('authorize()', () => {
  let session: ReturnType<typeof createSession>;

  beforeEach(() => {
    session = createSession();
  });

  it('rejects requests without a session cookie', () => {
    expect(authorize(req('http://panel.example.com/api/gateway/x'))).toBe('no-session');
  });

  it('accepts GET with only the session cookie', () => {
    expect(
      authorize(req('http://panel.example.com/x', { cookies: { [SESSION_COOKIE]: session.id } })),
    ).toBeNull();
  });

  it('rejects approve POST without a CSRF token', () => {
    expect(
      authorize(
        req('http://panel.example.com/api/gateway/v1/runs/r1/approve', {
          method: 'POST',
          cookies: { [SESSION_COOKIE]: session.id },
        }),
        { csrf: true },
      ),
    ).toBe('csrf-missing');
  });

  it('accepts POST with correct double-submit CSRF token', () => {
    expect(
      authorize(
        req('http://panel.example.com/api/gateway/v1/runs/r1/approve', {
          method: 'POST',
          cookies: { [SESSION_COOKIE]: session.id, [CSRF_COOKIE]: session.csrfToken },
          headers: { [CSRF_HEADER]: session.csrfToken },
        }),
        { csrf: true },
      ),
    ).toBeNull();
  });

  it('rejects mismatched CSRF token', () => {
    expect(
      authorize(
        req('http://panel.example.com/api/gateway/v1/runs/r1/deny', {
          method: 'POST',
          cookies: { [SESSION_COOKIE]: session.id, [CSRF_COOKIE]: 'wrong' },
          headers: { [CSRF_HEADER]: 'wrong' },
        }),
        { csrf: true },
      ),
    ).toBe('csrf-mismatch');
  });

  it('rejects cross-origin POST even with a valid CSRF pair', () => {
    expect(
      authorize(
        req('http://panel.example.com/api/gateway/v1/runs/r1/approve', {
          method: 'POST',
          cookies: { [SESSION_COOKIE]: session.id, [CSRF_COOKIE]: session.csrfToken },
          headers: { [CSRF_HEADER]: session.csrfToken, origin: 'https://evil.example' },
        }),
        { csrf: true },
      ),
    ).toBe('bad-origin');
  });
});

describe('originMatchesRequest', () => {
  it('matches same-host origins', () => {
    expect(originMatchesRequest(req('http://x', { headers: { origin: 'https://panel.example.com' } }))).toBe(true);
  });
  it('mismatches foreign origins', () => {
    expect(originMatchesRequest(req('http://x', { headers: { origin: 'https://evil.example' } }))).toBe(false);
  });
});

describe('SSE via fetch stream tokens', () => {
  it('maps a bearer stream token back to its live session', () => {
    const s = createSession();
    const token = createStreamToken(s.id);
    const redeemed = redeemStreamToken(token);
    expect(redeemed?.id).toBe(s.id);
  });

  it('refuses unknown tokens', () => {
    expect(redeemStreamToken('nope')).toBeNull();
  });
});

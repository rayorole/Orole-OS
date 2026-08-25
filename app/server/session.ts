// Server-side session store + CSRF primitives.
//
// Security model (issue #32):
// - The browser NEVER holds the Hermes gateway admin key. It holds an opaque,
//   random session id in an httpOnly / SameSite=Lax cookie only.
// - Sessions live server-side (in-memory; swap the Store interface for Redis
//   etc. in multi-instance deployments).
// - Mutating, high-consequence actions (approve/deny) additionally require a
//   CSRF token: double-submit cookie + Origin check.

import { randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'orole_session';
export const CSRF_COOKIE = 'orole_csrf';
export const CSRF_HEADER = 'x-csrf-token';

export const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12h

export interface Session {
  id: string;
  csrfToken: string;
  createdAt: number;
  expiresAt: number;
}

export interface SessionStore {
  create(session: Session): void;
  get(id: string): Session | undefined;
  delete(id: string): void;
}

/** In-memory store. Fine for single-instance deploys; swap for Redis otherwise. */
export class MemorySessionStore implements SessionStore {
  private sessions = new Map<string, Session>();

  create(session: Session): void {
    this.sessions.set(session.id, session);
  }

  get(id: string): Session | undefined {
    const s = this.sessions.get(id);
    if (!s) return undefined;
    if (Date.now() > s.expiresAt) {
      this.sessions.delete(id);
      return undefined;
    }
    return s;
  }

  delete(id: string): void {
    this.sessions.delete(id);
  }
}

const globalStore = globalThis as unknown as { __oroleSessions?: SessionStore };
export const sessionStore: SessionStore =
  globalStore.__oroleSessions ?? new MemorySessionStore();
globalStore.__oroleSessions = sessionStore;

export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function createSession(): Session {
  const now = Date.now();
  const session: Session = {
    id: newToken(),
    csrfToken: newToken(),
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  };
  sessionStore.create(session);
  return session;
}

/** Constant-time comparison of two strings; false on length mismatch. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function parseCookies(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

/** Resolve the current session from the request cookie, or null. */
export function getSessionFromRequest(req: Request): Session | null {
  const cookies = parseCookies(req.headers.get('cookie'));
  const id = cookies[SESSION_COOKIE];
  if (!id) return null;
  return sessionStore.get(id) ?? null;
}

/**
 * Bearer fallback for the SSE transport: the browser cannot attach the
 * httpOnly cookie as a header, so it first exchanges its session for a
 * short-lived stream token (see /api/auth/stream-token) and connects with
 * `Authorization: Bearer <token>`. Tokens never appear in URLs.
 */
const streamTokens = new Map<string, { sessionId: string; expiresAt: number }>();

export function createStreamToken(sessionId: string, ttlMs = 60_000): string {
  const token = newToken();
  // Opportunistic cleanup so the map cannot grow unbounded.
  if (streamTokens.size > 10_000) {
    const now = Date.now();
    for (const [t, v] of streamTokens) {
      if (now > v.expiresAt) streamTokens.delete(t);
    }
  }
  streamTokens.set(token, { sessionId, expiresAt: Date.now() + ttlMs });
  return token;
}

export function redeemStreamToken(token: string): Session | null {
  const entry = streamTokens.get(token);
  if (!entry || Date.now() > entry.expiresAt) {
    streamTokens.delete(token);
    return null;
  }
  return sessionStore.get(entry.sessionId) ?? null;
}

/** Same-site request? Compares Origin against Host when Origin is present. */
export function originMatchesRequest(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true; // same-origin fetches may omit Origin; CSRF token covers us
  try {
    return new URL(origin).host === req.headers.get('host');
  } catch {
    return false;
  }
}

export type AuthFailure = 'no-session' | 'csrf-missing' | 'csrf-mismatch' | 'bad-origin';

/**
 * Require a valid session; for state-changing methods additionally require the
 * CSRF double-submit check + Origin validation. Returns null when authorized.
 */
export function authorize(req: Request, opts?: { csrf?: boolean }): AuthFailure | null {
  const session = getSessionFromRequest(req);
  if (!session) return 'no-session';

  const needsCsrf = opts?.csrf ?? (req.method !== 'GET' && req.method !== 'HEAD');
  if (!needsCsrf) return null;

  if (!originMatchesRequest(req)) return 'bad-origin';

  const cookies = parseCookies(req.headers.get('cookie'));
  const headerToken = req.headers.get(CSRF_HEADER) ?? '';
  const cookieToken = cookies[CSRF_COOKIE] ?? '';
  if (!headerToken || !cookieToken) return 'csrf-missing';
  if (!safeEqual(headerToken, cookieToken) || !safeEqual(headerToken, session.csrfToken)) {
    return 'csrf-mismatch';
  }
  return null;
}

export function sessionCookieHeaders(session: Session, secure: boolean): string[] {
  const base = `Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
  return [
    `${SESSION_COOKIE}=${session.id}; ${base}; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    // CSRF cookie is deliberately NOT httpOnly: the client reads it to echo
    // it back in the x-csrf-token header (double-submit pattern).
    `${CSRF_COOKIE}=${session.csrfToken}; Path=/; SameSite=Lax${secure ? '; Secure' : ''}`,
  ];
}

export function clearCookieHeaders(): string[] {
  return [
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    `${CSRF_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0`,
  ];
}

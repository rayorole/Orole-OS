/**
 * API configuration for Orole-OS.
 *
 * SECURITY (issue #32): the gateway admin key is NEVER stored in the browser.
 * Login exchanges the key (typed once) for an httpOnly session cookie — see
 * ./session-client. This module keeps only non-secret UI configuration and
 * provides a credential-provider seam whose implementations refuse to hold
 * raw keys, so legacy call sites keep compiling while being no-ops.
 */

export const LEGACY_API_KEY_STORAGE_KEY = 'orole.apiKey'
export const API_BASE_URL_STORAGE_KEY = 'orole.apiBaseUrl'

/** Default OpenAI-compatible backend used by the panel. */
export const DEFAULT_API_BASE_URL = ''

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // storage unavailable (private mode etc.)
  }
}

function safeRemove(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // ignore
  }
}

/**
 * One-time migration: scrub any pre-#32 key left in localStorage by an older
 * build so the raw secret never lingers in the browser.
 */
export function purgeLegacyStoredKey(): void {
  safeRemove(LEGACY_API_KEY_STORAGE_KEY)
}

export function getBaseUrl(): string {
  return safeGet(API_BASE_URL_STORAGE_KEY) || DEFAULT_API_BASE_URL
}

export function setBaseUrl(url: string): void {
  const trimmed = url.trim().replace(/\/+$/, '')
  if (!trimmed) {
    safeRemove(API_BASE_URL_STORAGE_KEY)
    return
  }
  try {
    const parsed = new URL(trimmed, window.location.origin)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('bad protocol')
    }
  } catch {
    throw new Error('Base URL must be an absolute http(s) URL')
  }
  safeSet(API_BASE_URL_STORAGE_KEY, trimmed)
}

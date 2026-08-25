/**
 * Credential + API configuration for Orole-OS.
 *
 * The key is stored only in the user's browser (localStorage under
 * `orole.apiKey`) and is never sent anywhere except the configured backend
 * base URL. The API client consumes credentials through this pluggable
 * provider seam — it never reads storage itself.
 */

export const API_KEY_STORAGE_KEY = 'orole.apiKey'
export const API_BASE_URL_STORAGE_KEY = 'orole.apiBaseUrl'

/** Default OpenAI-compatible backend used by the panel. */
export const DEFAULT_API_BASE_URL = 'https://os.orole.be'

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
    // storage unavailable (private mode etc.) — key just won't persist
  }
}

function safeRemove(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // ignore
  }
}

export interface ApiCredentials {
  apiKey: string | null
}

export interface CredentialProvider {
  getCredentials(): ApiCredentials
  setApiKey(apiKey: string): void
  clearApiKey(): void
  getBaseUrl(): string
  setBaseUrl(url: string): void
}

/**
 * localStorage-backed credential provider. Swappable in tests or if a
 * different storage strategy is ever needed.
 */
export const localStorageCredentialProvider: CredentialProvider = {
  getCredentials(): ApiCredentials {
    return { apiKey: safeGet(API_KEY_STORAGE_KEY) }
  },
  setApiKey(apiKey: string): void {
    const trimmed = apiKey.trim()
    if (!trimmed) throw new Error('API key must not be empty')
    safeSet(API_KEY_STORAGE_KEY, trimmed)
  },
  clearApiKey(): void {
    safeRemove(API_KEY_STORAGE_KEY)
  },
  getBaseUrl(): string {
    return safeGet(API_BASE_URL_STORAGE_KEY) || DEFAULT_API_BASE_URL
  },
  setBaseUrl(url: string): void {
    const trimmed = url.trim().replace(/\/+$/, '')
    if (!trimmed) {
      safeRemove(API_BASE_URL_STORAGE_KEY)
      return
    }
    try {
      // Validate it is an absolute http(s) URL before persisting.
      const parsed = new URL(trimmed)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('bad protocol')
      }
    } catch {
      throw new Error('Base URL must be an absolute http(s) URL')
    }
    safeSet(API_BASE_URL_STORAGE_KEY, trimmed)
  },
}

/** Active provider — the single place the app binds storage to the client. */
let activeProvider: CredentialProvider = localStorageCredentialProvider

export function getCredentialProvider(): CredentialProvider {
  return activeProvider
}

export function setCredentialProvider(provider: CredentialProvider): void {
  activeProvider = provider
}

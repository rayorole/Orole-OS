/**
 * Orole-OS failure taxonomy — shared by the API client layer and every
 * async surface in the panel. One classification, rendered once by the
 * shared <ErrorState /> / <PanelState /> components.
 */

export const FailureClass = {
  NO_KEY: 'NO_KEY',
  AUTH_FAILED: 'AUTH_FAILED',
  NETWORK_OR_CORS: 'NETWORK_OR_CORS',
  SERVER_ERROR: 'SERVER_ERROR',
  EMPTY: 'EMPTY',
  LOADING: 'LOADING',
} as const

export type FailureClass = (typeof FailureClass)[keyof typeof FailureClass]

/** Thrown by API client wrappers when no key is configured at all. */
export class NoApiKeyError extends Error {
  constructor(message = 'No API key configured') {
    super(message)
    this.name = 'NoApiKeyError'
  }
}

/** Thrown by API client wrappers on 401/403 (revoked or wrong key). */
export class AuthFailedError extends Error {
  constructor(message = 'API key was rejected') {
    super(message)
    this.name = 'AuthFailedError'
  }
}

/** Thrown by API client wrappers when the gateway is unreachable (network/CORS). */
export class NetworkOrCorsError extends Error {
  constructor(message = 'Could not reach the gateway') {
    super(message)
    this.name = 'NetworkOrCorsError'
  }
}

/** Thrown by API client wrappers on 5xx from the backend. */
export class ServerError extends Error {
  readonly status: number
  constructor(status: number, message = 'Gateway returned a server error') {
    super(message)
    this.name = 'ServerError'
    this.status = status
  }
}

type Classifiable = {
  status?: number
  code?: string | number
  message?: string
}

/**
 * Map any thrown value to a failure class. This is the single place where
 * raw errors become UI-meaningful categories; components trust it.
 */
export function classifyFailure(error: unknown): Exclude<
  FailureClass,
  typeof FailureClass.EMPTY | typeof FailureClass.LOADING
> {
  if (
    error instanceof NoApiKeyError ||
    error instanceof AuthFailedError ||
    error instanceof NetworkOrCorsError ||
    error instanceof ServerError
  ) {
    switch (error.name) {
      case 'NoApiKeyError':
        return FailureClass.NO_KEY
      case 'AuthFailedError':
        return FailureClass.AUTH_FAILED
      case 'NetworkOrCorsError':
        return FailureClass.NETWORK_OR_CORS
      default:
        return FailureClass.SERVER_ERROR
    }
  }

  // Duck-typed errors from fetch wrappers / other clients
  const e = error as Classifiable | null | undefined
  if (e && typeof e === 'object') {
    const status = typeof e.status === 'number' ? e.status : undefined
    if (status === 401 || status === 403) return FailureClass.AUTH_FAILED
    if (status !== undefined && status >= 500) return FailureClass.SERVER_ERROR
    const msg = (e.message ?? '').toLowerCase()
    if (
      msg.includes('api key') ||
      e.code === 'missing_api_key' ||
      e.code === 'no_api_key'
    ) {
      return FailureClass.NO_KEY
    }
    if (
      msg.includes('failed to fetch') ||
      msg.includes('networkerror') ||
      msg.includes('load failed') ||
      msg.includes('cors')
    ) {
      return FailureClass.NETWORK_OR_CORS
    }
  }

  return FailureClass.NETWORK_OR_CORS
}

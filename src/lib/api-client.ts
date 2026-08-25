/**
 * Orole-OS API client (issue #32).
 *
 * All requests go through the same-origin server proxy (/api/gateway/*) and
 * are authenticated by the httpOnly session cookie. The browser holds no key.
 */

import { getCsrfToken, CSRF_HEADER } from './session-client'

export type ConnectionStatus =
  | 'connected'
  | 'unauthorized'
  | 'network-error'
  | 'server-error'
  | 'no-session'

/** Error carrying a classified connection failure. Never includes secrets. */
export class ApiError extends Error {
  readonly status: ConnectionStatus
  constructor(status: ConnectionStatus, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export interface ModelInfo {
  id: string
  owned_by?: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        ...(getCsrfToken() ? { [CSRF_HEADER]: getCsrfToken() } : {}),
        ...(init?.headers as Record<string, string> | undefined),
      },
    })
  } catch {
    throw new ApiError('network-error', 'Could not reach the backend. Check your network.')
  }

  if (!response.ok) {
    if (response.status === 401) throw new ApiError('no-session', 'Session expired — sign in again.')
    if (response.status === 403) throw new ApiError('unauthorized', 'Request rejected (CSRF/permission).')
    throw new ApiError('server-error', `Backend error (HTTP ${response.status}).`)
  }
  return (await response.json()) as T
}

export interface ModelsResponse {
  data?: ModelInfo[]
}

/** Cheap authenticated ping through the session proxy. */
export function listModels(): Promise<ModelsResponse> {
  return request<ModelsResponse>('/api/gateway/v1/models')
}

/**
 * Open an SSE stream over fetch with a bearer stream token (never EventSource,
 * never ?token= in URLs). Re-exports the session-client helper for callers.
 */
export { openEventStream } from './session-client'

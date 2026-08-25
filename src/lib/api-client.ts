/**
 * Minimal OpenAI-compatible API client for Orole-OS.
 *
 * Auth: the API key from the credential provider is attached as
 * `Authorization: Bearer <key>` on every request and is sent only to the
 * configured base URL. The key is never logged or included in errors.
 */

import {
  DEFAULT_API_BASE_URL,
  getCredentialProvider,
} from './api-config'

export type ConnectionStatus =
  | 'connected'
  | 'unauthorized'
  | 'network-error'
  | 'server-error'
  | 'no-key'

/** Error carrying a classified connection failure. The API key never appears here. */
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

function authHeaders(): HeadersInit {
  const { apiKey } = getCredentialProvider().getCredentials()
  if (!apiKey) {
    throw new ApiError('no-key', 'No API key configured. Add one in Settings.')
  }
  return { Authorization: `Bearer ${apiKey}` }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const baseUrl = getCredentialProvider().getBaseUrl() || DEFAULT_API_BASE_URL
  let response: Response
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(authHeaders() as Record<string, string>),
        ...init?.headers,
      },
    })
  } catch {
    // fetch rejects on network failures and CORS-blocked preflights alike;
    // both surface to the user as the same actionable state.
    throw new ApiError(
      'network-error',
      'Could not reach the backend. Check your network or the CORS configuration below.',
    )
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new ApiError('unauthorized', 'The backend rejected this API key.')
    }
    throw new ApiError(
      'server-error',
      `Backend error (HTTP ${response.status}).`,
    )
  }
  return (await response.json()) as T
}

export interface ModelsResponse {
  data?: ModelInfo[]
}

/** Cheap authenticated ping: list models on the OpenAI-compatible API. */
export async function listModels(): Promise<ModelsResponse> {
  return request<ModelsResponse>('/v1/models')
}

/**
 * Kill switch — Hermes Runs API control endpoints.
 *
 * Endpoints (https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server):
 *   POST /v1/runs/{id}/cancel  → cancel a running Hermes run
 *   POST /v1/runs/{id}/pause   → pause a running agent / run
 *
 * The base URL and auth header mirror the activity feed's transport so both
 * panels talk to the same gateway.
 */

export const runsApiBase = (): string =>
  (import.meta.env.VITE_HERMES_API_URL ?? 'https://os.orole.be').replace(/\/$/, '')

export const HERMES_API_KEY: string =
  (import.meta.env.VITE_HERMES_API_KEY as string | undefined) ?? ''

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (HERMES_API_KEY) h.Authorization = `Bearer ${HERMES_API_KEY}`
  return h
}

export class RunControlError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'RunControlError'
  }
}

async function post(path: string, signal?: AbortSignal): Promise<void> {
  let res: Response
  try {
    res = await fetch(`${runsApiBase()}${path}`, {
      method: 'POST',
      headers: headers(),
      signal,
    })
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err
    throw new RunControlError(`network error contacting Hermes API`, 0)
  }
  if (!res.ok) {
    let detail = ''
    try {
      const body = (await res.json()) as { error?: string; message?: string }
      detail = body.error ?? body.message ?? ''
    } catch {
      /* non-JSON body */
    }
    throw new RunControlError(
      `HTTP ${res.status}${detail ? `: ${detail}` : ''}`,
      res.status,
    )
  }
}

/** Cancel one live run. */
export function cancelRun(runId: string, signal?: AbortSignal): Promise<void> {
  return post(`/v1/runs/${encodeURIComponent(runId)}/cancel`, signal)
}

/** Pause an agent's current run. */
export function pauseRun(runId: string, signal?: AbortSignal): Promise<void> {
  return post(`/v1/runs/${encodeURIComponent(runId)}/pause`, signal)
}

/** Optimistic UI state machine for a kill-switch action. */
export type ControlActionState = 'idle' | 'pending' | 'done' | 'error'

/**
 * Approval inbox data layer — pending run approvals for the Orole-OS panel.
 *
 * Backend contract (Hermes gateway, confirmed from api-server source):
 *  - Pending approvals are discovered through the shared activity SSE stream:
 *    a run emits `approval.request` ({run_id, command, description, choices,
 *    timestamp}) and its pollable status flips to `waiting_for_approval`.
 *    There is no GET list endpoint.
 *  - Resolution: POST /v1/runs/{run_id}/approval
 *      body { choice: "once" | "session" | "always" | "deny", all?, reason? }
 *      ("approve" / "allow" are server-side aliases of "once")
 *      → 200 { object:"hermes.run.approval_response", run_id, choice, resolved }
 *      → 409 { error.code: "approval_not_active" | "approval_not_pending" }
 *        when another client already decided — the card must be removed.
 *      → 404 run_not_found — treat like 409 (stale card).
 */

export const GATEWAY_BASE = (
  import.meta.env.VITE_HERMES_BASE_URL ?? 'https://os.orole.be'
).replace(/\/$/, '')
export const HERMES_API_KEY = import.meta.env.VITE_HERMES_API_KEY ?? ''

/** A run waiting on a human decision. */
export interface PendingApproval {
  runId: string
  /** The specific action/command awaiting approval (redacted server-side). */
  command: string
  description?: string
  agent?: string
  taskSummary?: string
  requestedAt: number // epoch ms
  choices?: string[]
}

export type ApprovalChoice = 'once' | 'session' | 'always' | 'deny'

export interface ApprovalResponse {
  object: 'hermes.run.approval_response'
  run_id: string
  choice: string
  resolved: number
}

/** Thrown when the approval was already resolved elsewhere (409) or the run is gone (404). */
export class AlreadyDecidedError extends Error {
  readonly status: number
  constructor(status: number) {
    super(
      status === 404
        ? 'Run not found — it may have already been resolved'
        : 'Approval already decided by another client',
    )
    this.name = 'AlreadyDecidedError'
    this.status = status
  }
}

function headers(extra?: Record<string, string>): Record<string, string> {
  const h = { Accept: 'application/json', ...extra }
  if (HERMES_API_KEY) h.Authorization = `Bearer ${HERMES_API_KEY}`
  return h
}

/**
 * Resolve one pending approval. `reason` is attached for denies so the agent
 * can adapt (relayed back as part of the BLOCKED message).
 */
export async function submitApproval(
  runId: string,
  choice: ApprovalChoice,
  opts: { reason?: string; all?: boolean; signal?: AbortSignal } = {},
): Promise<ApprovalResponse> {
  const body: Record<string, unknown> = { choice }
  if (opts.reason && opts.reason.trim() !== '') body.reason = opts.reason.trim()
  if (opts.all) body.all = true

  let res: Response
  try {
    res = await fetch(`${GATEWAY_BASE}/v1/runs/${encodeURIComponent(runId)}/approval`, {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
      signal: opts.signal,
    })
  } catch {
    throw new Error(`Could not reach ${GATEWAY_BASE} to ${choice === 'deny' ? 'deny' : 'approve'} the request`)
  }

  if (res.status === 409 || res.status === 404) throw new AlreadyDecidedError(res.status)
  if (!res.ok) {
    let detail = ''
    try {
      const data = (await res.json()) as { error?: { message?: string } }
      detail = data?.error?.message ? `: ${data.error.message}` : ''
    } catch {
      // non-JSON body
    }
    throw new Error(`Approval failed (HTTP ${res.status})${detail}`)
  }
  return (await res.json()) as ApprovalResponse
}

// ── SSE event folding ─────────────────────────────────────────────────────────

/**
 * Normalize an SSE activity-stream frame into a state transition on the
 * approvals map. Exported pure for tests.
 *
 * Handles:
 *  - `approval.request` → insert/update a pending card
 *  - any lifecycle event (`run.started/completed/failed/cancelled`,
 *    `approval.responded`, …) referencing a tracked run → remove it
 *    (the decision was recorded or the run left the waiting state)
 */
export function foldActivityEvent(
  prev: Record<string, PendingApproval>,
  eventName: string,
  data: Record<string, unknown>,
): Record<string, PendingApproval> {
  if (eventName === 'approval.request') {
    const runId = typeof data.run_id === 'string' ? data.run_id : ''
    if (!runId) return prev
    const existing = prev[runId]
    return {
      ...prev,
      [runId]: {
        runId,
        command: typeof data.command === 'string' ? data.command : '',
        description:
          typeof data.description === 'string' ? data.description : undefined,
        agent:
          typeof data.agent === 'string' ? data.agent : existing?.agent,
        taskSummary:
          typeof data.summary === 'string'
            ? data.summary
            : typeof data.input === 'string'
              ? data.input
              : existing?.taskSummary,
        requestedAt:
          typeof data.timestamp === 'number'
            ? data.timestamp * 1000
            : (existing?.requestedAt ?? Date.now()),
        choices: Array.isArray(data.choices)
          ? data.choices.map(String)
          : existing?.choices,
      },
    }
  }

  const runId = typeof data.run_id === 'string' ? data.run_id : ''
  if (runId && runId in prev && eventName !== 'tool.started' && eventName !== 'tool.completed') {
    const next = { ...prev }
    delete next[runId]
    return next
  }
  return prev
}

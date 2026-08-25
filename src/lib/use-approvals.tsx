import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlreadyDecidedError,
  foldActivityEvent,
  GATEWAY_BASE,
  HERMES_API_KEY,
  submitApproval,
  type ApprovalChoice,
  type PendingApproval,
} from './approvals'

export type InboxStatus = 'idle' | 'connecting' | 'live' | 'reconnecting'

/**
 * useApprovals — approval inbox state machine.
 *
 * Backed by the shared activity SSE stream (approval.request events insert
 * cards; lifecycle events remove them). Approve/Deny are optimistic: the card
 * is removed immediately and restored on failure unless the failure is a 409/404
 * (already decided elsewhere) — those keep the card removed and surface a note.
 */
export function useApprovals() {
  const [pending, setPending] = useState<Record<string, PendingApproval>>({})
  const [status, setStatus] = useState<InboxStatus>('idle')
  const [lastError, setLastError] = useState<string | null>(null)
  const [decidedNote, setDecidedNote] = useState<string | null>(null)
  const [inFlight, setInFlight] = useState<Record<string, ApprovalChoice>>({})
  // Keep a ref of pending so an optimistic removal can be reverted exactly.
  const snapshotRef = useRef<Record<string, PendingApproval>>({})
  snapshotRef.current = pending
  const sourceRef = useRef<EventSource | null>(null)

  // Live activity stream with reconnect + backoff.
  useEffect(() => {
    if (typeof EventSource === 'undefined') return
    let stopped = false
    let retry = 0
    let es: EventSource | null = null
    let timer: ReturnType<typeof setTimeout> | null = null

    const connect = () => {
      if (stopped) return
      setStatus(retry === 0 ? 'connecting' : 'reconnecting')
      const url = `${GATEWAY_BASE}/v1/runs/_activity/events`
      es = new EventSource(
        HERMES_API_KEY ? url : url,
        // EventSource cannot carry headers; the gateway also accepts ?api_key=
        HERMES_API_KEY ? { withCredentials: false } : undefined,
      )
      sourceRef.current = es

      es.onopen = () => {
        retry = 0
        setStatus('live')
      }
      es.onerror = () => {
        es?.close()
        if (stopped) return
        setStatus('reconnecting')
        const delay = Math.min(1000 * 2 ** retry, 15000)
        retry += 1
        timer = setTimeout(connect, delay)
      }

      for (const name of ['approval.request', 'run.started', 'run.completed', 'run.failed', 'run.cancelled', 'approval.responded']) {
        es.addEventListener(name, (ev) => {
          let data: Record<string, unknown> = {}
          try {
            data = JSON.parse((ev as MessageEvent).data as string)
          } catch {
            return
          }
          setPending((prev) => foldActivityEvent(prev, name, data))
        })
      }
    }

    connect()
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      es?.close()
      sourceRef.current = null
    }
  }, [])

  /**
   * Optimistic decide: remove the card up front, POST in the background,
   * restore on recoverable errors. 409/404 keeps it removed (concurrent
   * decision elsewhere wins — no double-submit).
   */
  const decide = useCallback(
    async (runId: string, choice: ApprovalChoice, reason?: string) => {
      setPending((prev) => {
        if (!(runId in prev)) return prev
        const next = { ...prev }
        delete next[runId]
        return next
      })
      setInFlight((prev) => ({ ...prev, [runId]: choice }))
      setLastError(null)
      try {
        await submitApproval(runId, choice, { reason })
        return true
      } catch (err) {
        if (!(err instanceof AlreadyDecidedError)) {
          // Revert optimistic removal so the user can retry.
          setLastError(
            err instanceof Error ? err.message : `Failed to ${choice} run ${runId}`,
          )
          const snapshot = snapshotRef.current[runId]
          setPending((prev) => (prev[runId] || !snapshot ? prev : { ...prev, [runId]: snapshot }))
          return false
        }
        setDecidedNote(`Run ${runId} was already decided elsewhere`)
        return true
      } finally {
        setInFlight((prev) => {
          const next = { ...prev }
          delete next[runId]
          return next
        })
      }
    },
    [],
  )

  const list = useMemo(
    () =>
      Object.values(pending).sort((a, b) => a.requestedAt - b.requestedAt),
    [pending],
  )

  // Keep the nav badge in sync with the inbox state.
  useEffect(() => {
    publishApprovalCount(list.length)
  }, [list.length])

  return {
    approvals: list,
    count: list.length,
    status,
    inFlight,
    lastError,
    decidedNote,
    dismissDecidedNote: useCallback(() => setDecidedNote(null), []),
    dismissError: useCallback(() => setLastError(null), []),
    decide,
  }
}

// ── Nav badge: live pending-approval count, synced with the inbox page via a
// tiny module-level store fed by useApprovals instances (and standalone when
// the inbox page is not mounted). ────────────────────────────────────────────

type Listener = () => void

const badgeState = { count: 0 }
const listeners = new Set<Listener>()

/** Called by useApprovals whenever the pending count changes. */
export function publishApprovalCount(count: number) {
  if (badgeState.count === count) return
  badgeState.count = count
  for (const fn of listeners) fn()
}

export function ApprovalNavBadge() {
  const [count, setCount] = useState(badgeState.count)
  useEffect(() => {
    const fn = () => setCount(badgeState.count)
    listeners.add(fn)
    fn()
    return () => {
      listeners.delete(fn)
    }
  }, [])
  if (count <= 0) return null
  return (
    <span className="ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full border border-status-pending/40 bg-status-pending/15 px-1.5 font-mono text-[10px] leading-4 text-status-pending">
      {count}
    </span>
  )
}

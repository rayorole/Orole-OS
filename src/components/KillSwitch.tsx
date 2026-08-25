import { useCallback, useState } from 'react'
import { OctagonX, Pause, RotateCcw } from 'lucide-react'

import { cancelRun, pauseRun, RunControlError } from '#/lib/run-control'

type Action = 'cancel' | 'pause'

interface RunControlState {
  phase: 'confirm' | 'pending' | 'error' | null
  action: Action | null
  error?: string
}

const LABELS: Record<Action, string> = {
  cancel: 'Cancel run',
  pause: 'Pause agent',
}

/**
 * Kill switch controls for one run: two clicks max — click the action,
 * click confirm. Optimistic UI flips the row to a pending glyph immediately;
 * failures roll back into an inline error state with retry.
 */
export function useRunControl(onSettled?: (id: string, action: Action) => void) {
  const [state, setState] = useState<RunControlState>({ phase: null, action: null })

  const arm = useCallback((id: string, action: Action) => {
    setState({ phase: 'confirm', action })
    void id
  }, [])

  const disarm = useCallback(() => {
    setState({ phase: null, action: null })
  }, [])

  const execute = useCallback(
    async (runId: string, optimisticApply: () => void) => {
      const action = state.action
      if (!action) return
      setState({ phase: 'pending', action })
      optimisticApply() // optimistic UI before the network round-trip
      try {
        if (action === 'cancel') await cancelRun(runId)
        else await pauseRun(runId)
        setState({ phase: null, action: null })
        onSettled?.(runId, action)
      } catch (err) {
        // Roll back is implicit: the SSE stream re-asserts true status; we
        // surface the failure explicitly instead of pretending it worked.
        setState({
          phase: 'error',
          action,
          error:
            err instanceof RunControlError
              ? `${LABELS[action]} failed — ${err.message}`
              : `${LABELS[action]} failed`,
        })
      }
    },
    [onSettled, state.action],
  )

  return { state, arm, disarm, execute }
}

export function KillSwitchButtons({
  runId,
  control,
  onExecute,
}: {
  runId: string
  control: ReturnType<typeof useRunControl>
  /** Optional override for the confirm-"yes" action (lets callers apply optimistic status). */
  onExecute?: (runId: string) => Promise<void> | void
}) {
  const { state } = control

  if (state.phase === 'error') {
    return (
      <div className="flex items-center gap-2">
        <span role="alert" className="font-mono text-[11px] text-red-400">
          {state.error}
        </span>
        <button
          type="button"
          onClick={() => {
            control.arm(runId, state.action ?? 'cancel')
          }}
          className="inline-flex items-center gap-1 rounded border border-red-500/40 px-2 py-0.5 font-mono text-[11px] text-red-300 hover:bg-red-500/10"
        >
          <RotateCcw className="size-3" /> retry
        </button>
        <button
          type="button"
          onClick={control.disarm}
          className="font-mono text-[11px] text-muted-foreground hover:text-foreground"
        >
          dismiss
        </button>
      </div>
    )
  }

  if (state.phase === 'confirm') {
    return (
      <div
        role="alertdialog"
        aria-label={`Confirm ${LABELS[state.action ?? 'cancel']}`}
        className="flex items-center gap-2 rounded border border-neon-violet/40 bg-neon-violet/5 px-2 py-1"
      >
        <span className="font-mono text-[11px] text-neon-violet">
          confirm {LABELS[state.action ?? 'cancel']?.toLowerCase()}?
        </span>
        <button
          type="button"
          onClick={() => {
            if (onExecute) void onExecute(runId)
            else
              void control.execute(runId, () => {
                /* caller applies optimistic status */
              })
          }}
          className="rounded bg-red-600/80 px-2 py-0.5 font-mono text-[11px] font-semibold text-white hover:bg-red-500"
        >
          yes
        </button>
        <button
          type="button"
          onClick={control.disarm}
          className="font-mono text-[11px] text-muted-foreground hover:text-foreground"
        >
          no
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        disabled={state.phase === 'pending'}
        aria-label={`Cancel run ${runId}`}
        title="Cancel run"
        onClick={() => control.arm(runId, 'cancel')}
        className="inline-flex items-center gap-1 rounded border border-red-500/40 px-2 py-0.5 font-mono text-[11px] text-red-300 transition-colors hover:bg-red-500/10 disabled:opacity-50"
      >
        <OctagonX className="size-3" /> cancel
      </button>
      <button
        type="button"
        disabled={state.phase === 'pending'}
        aria-label={`Pause agent run ${runId}`}
        title="Pause agent"
        onClick={() => control.arm(runId, 'pause')}
        className="inline-flex items-center gap-1 rounded border border-amber-500/40 px-2 py-0.5 font-mono text-[11px] text-amber-300 transition-colors hover:bg-amber-500/10 disabled:opacity-50"
      >
        <Pause className="size-3" /> pause
      </button>
      {state.phase === 'pending' && (
        <span aria-live="polite" className="animate-pulse font-mono text-[11px] text-neon-cyan">
          …
        </span>
      )}
    </div>
  )
}

import { useCallback, useState } from 'react'
import { OctagonX, Pause, RotateCcw } from 'lucide-react'

import { cancelRun, pauseRun, RunControlError } from '#/lib/run-control'
import { Alert, AlertDescription } from '#/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#/components/ui/alert-dialog'
import { Button } from '#/components/ui/button'
import { Spinner } from '#/components/ui/spinner'

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
 * click confirm (via an AlertDialog). Optimistic UI flips the row to a
 * pending glyph immediately; failures roll back into an inline error state
 * with retry.
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
  const confirmLabel = LABELS[state.action ?? 'cancel']
  const confirmOpen = state.phase === 'confirm'
  const pending = state.phase === 'pending'

  const runConfirmedAction = () => {
    if (onExecute) void onExecute(runId)
    else
      void control.execute(runId, () => {
        /* caller applies optimistic status */
      })
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-6 gap-1 border-red-500/40 px-2 font-mono text-[11px] text-red-300 hover:bg-red-500/10 hover:text-red-200"
        disabled={pending}
        aria-label={`Cancel run ${runId}`}
        title="Cancel run"
        onClick={() => control.arm(runId, 'cancel')}
      >
        <OctagonX className="size-3" /> cancel
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-6 gap-1 border-amber-500/40 px-2 font-mono text-[11px] text-amber-300 hover:bg-amber-500/10 hover:text-amber-200"
        disabled={pending}
        aria-label={`Pause agent run ${runId}`}
        title="Pause agent"
        onClick={() => control.arm(runId, 'pause')}
      >
        <Pause className="size-3" /> pause
      </Button>

      {state.phase === 'error' && (
        <Alert variant="destructive" className="w-auto gap-2 px-2 py-1">
          <AlertDescription className="flex items-center gap-2 font-mono text-[11px]">
            <span>{state.error}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-5 gap-1 border-red-500/40 px-2 py-0 font-mono text-[11px] text-red-300 hover:bg-red-500/10"
              onClick={() => {
                control.arm(runId, state.action ?? 'cancel')
              }}
            >
              <RotateCcw className="size-3" /> retry
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-5 px-2 py-0 font-mono text-[11px]"
              onClick={control.disarm}
            >
              dismiss
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {pending && (
        <span aria-live="polite" className="inline-flex items-center gap-1 font-mono text-[11px] text-neon-cyan">
          <Spinner className="size-3" />
        </span>
      )}

      <AlertDialog
        open={confirmOpen || pending}
        onOpenChange={(open) => {
          if (!open && !pending) control.disarm()
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm {confirmLabel.toLowerCase()}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will {confirmLabel.toLowerCase()} for run {runId}. The live SSE
              stream re-asserts true status afterwards.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>No</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                e.preventDefault()
                runConfirmedAction()
              }}
            >
              {pending ? <Spinner className="size-3" /> : 'Yes'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

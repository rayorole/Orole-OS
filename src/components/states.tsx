import { type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldAlert,
  WifiOff,
} from 'lucide-react'

import { Button } from '#/components/ui/button'
import { Card, CardContent } from '#/components/ui/card'
import {
  FailureClass,
  classifyFailure,
  type FailureClass as FailureClassType,
} from '#/lib/errors'

/* ── Skeleton ──────────────────────────────────────────────────────────── */

export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-md bg-[var(--muted)] ${className}`}
    />
  )
}

/** Themed loading skeleton for a panel region. */
export function LoadingState({
  label = 'Loading',
  rows = 3,
}: {
  label?: string
  rows?: number
}) {
  return (
    <div role="status" aria-label={label} className="space-y-3">
      <span className="sr-only">{label}…</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  )
}

/* ── Empty ─────────────────────────────────────────────────────────────── */

/** Friendly empty state with an optional call-to-action. */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-[var(--border)] px-6 py-10 text-center">
      {icon && <div className="text-[var(--neon-violet)]">{icon}</div>}
      <p className="font-mono text-sm uppercase tracking-widest text-[var(--neon-cyan)]/80">
        {title}
      </p>
      {description && (
        <p className="max-w-sm text-sm text-[var(--muted-foreground)]">
          {description}
        </p>
      )}
      {action && <div className="pt-1">{action}</div>}
    </div>
  )
}

/* ── Error ─────────────────────────────────────────────────────────────── */

const ERROR_COPY: Record<
  Exclude<FailureClassType, typeof FailureClass.EMPTY | typeof FailureClass.LOADING>,
  { icon: typeof WifiOff; title: string; recovery: string }
> = {
  [FailureClass.NO_KEY]: {
    icon: KeyRound,
    title: 'No API key connected',
    recovery: 'Add your gateway API key in Settings to bring this panel online.',
  },
  [FailureClass.AUTH_FAILED]: {
    icon: ShieldAlert,
    title: 'API key rejected',
    recovery: 'Your key looks revoked or invalid — update it in Settings.',
  },
  [FailureClass.NETWORK_OR_CORS]: {
    icon: WifiOff,
    title: "Can't reach os.orole.be",
    recovery:
      'The gateway is unreachable (network or CORS). Check the backend status or CORS guidance in Settings, then retry.',
  },
  [FailureClass.SERVER_ERROR]: {
    icon: AlertTriangle,
    title: 'Gateway error',
    recovery:
      'os.orole.be returned a server error. It is not your setup — try again shortly.',
  },
}

/** Categorized error state with a concrete recovery step and scoped retry. */
export function ErrorState({
  error,
  retry,
  onGoToSettings,
}: {
  error: unknown
  /** Re-triggers only the failed surface's query — never a page reload. */
  retry?: () => void
  onGoToSettings?: () => void
}) {
  const failureClass = classifyFailure(error)
  const copy = ERROR_COPY[failureClass]
  const Icon = copy.icon

  return (
    <Card className="border-destructive/30 bg-destructive/5">
      <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
        <Icon
          aria-hidden="true"
          className="size-8 text-destructive drop-shadow-[0_0_8px_var(--destructive)]"
        />
        <p className="font-mono text-sm uppercase tracking-widest text-destructive">
          {copy.title}
        </p>
        <p className="max-w-sm text-sm text-[var(--muted-foreground)]">
          {copy.recovery}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
          {(failureClass === FailureClass.NO_KEY ||
            failureClass === FailureClass.AUTH_FAILED) &&
            onGoToSettings !== undefined && (
              <Button size="sm" variant="outline" onClick={onGoToSettings}>
                Open Settings
              </Button>
            )}
          {retry && (
            <Button size="sm" variant="outline" onClick={retry}>
              <RefreshCw aria-hidden="true" className="mr-1.5 size-3.5" />
              Retry
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * Renders the right state for a TanStack Query hook result:
 * loading skeleton → categorized error → friendly empty → data.
 * The retry button calls query.refetch() so only the failed surface reloads.
 */
export function PanelState<TData>({
  query,
  isEmpty,
  emptyTitle,
  emptyDescription,
  emptyAction,
  children,
}: {
  query: {
    isPending: boolean
    isError: boolean
    error: unknown
    data?: unknown
    refetch: () => unknown
  }
  /** Return true when `data` counts as "nothing here yet". */
  isEmpty?: (data: NonNullable<TData>) => boolean
  emptyTitle?: string
  emptyDescription?: string
  emptyAction?: ReactNode
  children: ReactNode
}) {
  if (query.isPending) return <LoadingState />

  if (query.isError) {
    return (
      <ErrorState
        error={query.error}
        retry={() => void query.refetch()}
      />
    )
  }

  if (isEmpty?.(query.data as NonNullable<TData>)) {
    return (
      <EmptyState
        title={emptyTitle ?? 'Nothing here yet'}
        description={emptyDescription}
        action={emptyAction}
      />
    )
  }

  return <>{children}</>
}

/** Small inline spinner for sub-surface refetches. */
export function InlineSpinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span role="status" aria-label={label} className="inline-flex items-center gap-2">
      <Loader2 aria-hidden="true" className="size-4 animate-spin text-[var(--neon-cyan)]" />
      <span className="text-xs text-[var(--muted-foreground)]">{label}…</span>
    </span>
  )
}

/** Convenience hook: get a refetch callback bound to a query key. */
export function useRefetch(queryKey: readonly unknown[]) {
  const queryClient = useQueryClient()
  return () => void queryClient.invalidateQueries({ queryKey })
}

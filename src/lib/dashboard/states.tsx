// Shared loading / empty / error panel states (consistent with issue #6).

import { cn } from '#/lib/utils'

export function PanelSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-4 animate-pulse rounded bg-muted/60"
          style={{ width: `${90 - i * 15}%` }}
        />
      ))}
    </div>
  )
}

export function CardGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="h-32 animate-pulse rounded-lg border border-border/50 bg-card"
        />
      ))}
    </div>
  )
}

export function EmptyState({
  title,
  hint,
}: {
  title: string
  hint?: string
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border/60 py-10 text-center">
      <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
        {title}
      </p>
      {hint && <p className="text-sm text-muted-foreground/70">{hint}</p>}
    </div>
  )
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 font-mono text-xs text-red-400"
    >
      error: {message}
    </div>
  )
}

export function PanelShell({
  title,
  subtitle,
  actions,
  className,
  children,
}: {
  title: string
  subtitle?: string
  actions?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <section
      className={cn(
        'rounded-xl border border-neon-cyan/15 bg-card/80 p-5 shadow-[0_0_24px_rgba(0,255,255,0.04)] backdrop-blur',
        className,
      )}
    >
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-mono text-sm uppercase tracking-[0.2em] text-neon-cyan">
            {title}
          </h2>
          {subtitle && (
            <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {actions}
      </header>
      {children}
    </section>
  )
}

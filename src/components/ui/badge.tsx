import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '#/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center justify-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        destructive:
          'border-transparent bg-destructive text-destructive-foreground',
        outline: 'text-foreground',
        /** running = green */
        running:
          'border-status-running/30 bg-status-running/10 text-status-running',
        /** pending = amber */
        pending:
          'border-status-pending/30 bg-status-pending/10 text-status-pending',
        /** failed = red */
        failed: 'border-status-failed/30 bg-status-failed/10 text-status-failed',
        /** idle = muted */
        idle: 'border-border bg-muted/40 text-muted-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<'span'> &
  VariantProps<typeof badgeVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : 'span'

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

/** Standardized agent/task status dot — glow reserved for live state. */
function StatusDot({
  status,
  className,
}: {
  status: 'running' | 'pending' | 'failed' | 'idle'
  className?: string
}) {
  return (
    <span
      data-slot="status-dot"
      aria-label={status}
      role="img"
      className={cn(
        'inline-block size-2 rounded-full bg-status-idle',
        status === 'running' &&
          'bg-status-running shadow-[0_0_8px_var(--status-running-glow)] motion-safe:animate-pulse',
        status === 'pending' && 'bg-status-pending',
        status === 'failed' && 'bg-status-failed',
        className
      )}
    />
  )
}

export { Badge, badgeVariants, StatusDot }

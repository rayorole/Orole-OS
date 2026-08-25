import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "#/lib/utils.ts"

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary:
          "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        destructive:
          "bg-destructive/10 text-destructive focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/20",
        outline:
          "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        ghost:
          "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline",
        /** running = green */
        running:
          "border-status-running/30 bg-status-running/10 text-status-running",
        /** pending = amber */
        pending:
          "border-status-pending/30 bg-status-pending/10 text-status-pending",
        /** failed = red */
        failed:
          "border-status-failed/30 bg-status-failed/10 text-status-failed",
        /** idle = muted */
        idle: "border-border bg-muted/40 text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
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
  status: "running" | "pending" | "failed" | "idle"
  className?: string
}) {
  return (
    <span
      data-slot="status-dot"
      aria-label={status}
      role="img"
      className={cn(
        "inline-block size-2 rounded-full bg-status-idle",
        status === "running" &&
          "bg-status-running shadow-[0_0_8px_var(--status-running-glow)] motion-safe:animate-pulse",
        status === "pending" && "bg-status-pending",
        status === "failed" && "bg-status-failed",
        className
      )}
    />
  )
}

export { Badge, badgeVariants, StatusDot }

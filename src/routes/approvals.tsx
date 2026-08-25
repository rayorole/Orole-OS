import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'

import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Badge, StatusDot } from '#/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '#/components/ui/alert-dialog'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '#/components/ui/empty'
import { Input } from '#/components/ui/input'
import { useApprovals, type InboxStatus } from '#/lib/use-approvals'
import type { PendingApproval } from '#/lib/approvals'

export const Route = createFileRoute('/approvals')({
  component: ApprovalsInbox,
})

function formatElapsed(fromMs: number, nowMs: number): string {
  const s = Math.max(0, Math.floor((nowMs - fromMs) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

const STATUS_LABEL: Record<InboxStatus, string> = {
  idle: 'offline',
  connecting: 'connecting…',
  live: 'live',
  reconnecting: 'reconnecting…',
}

function ApprovalCard({
  approval,
  inFlightChoice,
  onDecide,
}: {
  approval: PendingApproval
  inFlightChoice?: string
  onDecide: (runId: string, choice: 'once' | 'deny', reason?: string) => void
}) {
  const [now, setNow] = useState(() => Date.now())
  const [denyOpen, setDenyOpen] = useState(false)
  const [reason, setReason] = useState('')

  // Live elapsed ticker.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const busy = inFlightChoice !== undefined

  return (
    <Card
      className="gap-3 border-status-pending/30 py-4"
      data-testid="approval-card"
      data-run-id={approval.runId}
    >
      <CardHeader className="px-4">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="font-mono text-sm text-neon-cyan">
            {approval.agent ?? 'agent'}
          </CardTitle>
          <Badge variant="pending">awaiting approval</Badge>
        </div>
        <CardDescription className="font-mono text-xs">
          run {approval.runId}
          {approval.taskSummary ? ` · ${approval.taskSummary}` : ''}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-4">
        {approval.command ? (
          <pre className="max-h-40 overflow-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-xs text-foreground">
            {approval.command}
          </pre>
        ) : null}
        {approval.description ? (
          <p className="text-sm text-muted-foreground">{approval.description}</p>
        ) : null}

        <div className="font-mono text-xs text-muted-foreground">
          requested {new Date(approval.requestedAt).toLocaleTimeString()} ·
          elapsed{' '}
          <span className="text-status-pending">
            {formatElapsed(approval.requestedAt, now)}
          </span>
        </div>

        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={busy}
            onClick={() => onDecide(approval.runId, 'once')}
          >
            {inFlightChoice === 'once' ? 'Approving…' : 'Approve'}
          </Button>

          {/* Destructive confirmation via AlertDialog. */}
          <AlertDialog
            open={denyOpen}
            onOpenChange={(open) => {
              setDenyOpen(open)
              if (!open) setReason('')
            }}
          >
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={busy}>
                Deny
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Deny this request?</AlertDialogTitle>
                <AlertDialogDescription className="font-mono">
                  The agent will be told its command was rejected.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <Input
                aria-label="Deny reason"
                className="font-mono text-xs"
                placeholder="optional reason for the agent…"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <AlertDialogFooter>
                <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  disabled={busy}
                  onClick={(e) => {
                    e.preventDefault()
                    setDenyOpen(false)
                    onDecide(approval.runId, 'deny', reason || undefined)
                    setReason('')
                  }}
                >
                  Confirm deny
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  )
}

function ApprovalsInbox() {
  const {
    approvals,
    count,
    status,
    inFlight,
    lastError,
    decidedNote,
    decide,
  } = useApprovals()

  // Re-render every second so elapsed times tick.
  const [, forceTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="hud-page flex flex-1 flex-col gap-6 py-14">
      <div className="space-y-2">
        <p className="hud-panel-title">approvals</p>
        <div className="flex items-center gap-3">
          <h1 className="bg-gradient-to-r from-neon-cyan via-foreground to-neon-violet bg-clip-text text-3xl font-bold text-transparent md:text-4xl">
            Approval Inbox
          </h1>
          {count > 0 ? <Badge variant="pending">{count}</Badge> : null}
        </div>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <StatusDot status={status === 'live' ? 'running' : status === 'reconnecting' ? 'failed' : 'idle'} />
          stream {STATUS_LABEL[status]}
        </p>
      </div>

      {lastError ? (
        <Alert variant="destructive" className="border-destructive/40 bg-destructive/10">
          <AlertTitle>{lastError}</AlertTitle>
          <AlertDescription className="font-mono text-xs text-muted-foreground">
            the card was restored — try again
          </AlertDescription>
        </Alert>
      ) : null}
      {decidedNote ? (
        <Alert aria-live="polite" className="border-border bg-muted/30">
          <AlertDescription className="text-muted-foreground">
            {decidedNote}
          </AlertDescription>
        </Alert>
      ) : null}

      {approvals.length === 0 ? (
        <Empty className="border-border py-10">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <StatusDot status="running" />
            </EmptyMedia>
            <EmptyTitle className="font-mono text-sm text-foreground">
              No pending approvals — all clear
            </EmptyTitle>
            <EmptyDescription>
              New requests appear here the moment an agent needs a decision.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <section
          aria-label="Pending approvals"
          className="grid w-full gap-4 md:grid-cols-2"
        >
          {approvals.map((a) => (
            <ApprovalCard
              key={a.runId}
              approval={a}
              inFlightChoice={inFlight[a.runId]}
              onDecide={decide}
            />
          ))}
        </section>
      )}
    </div>
  )
}

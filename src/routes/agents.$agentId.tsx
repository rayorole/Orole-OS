import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { useAgentStream } from '#/lib/hooks'

export const Route = createFileRoute('/agents/$agentId')({
  component: AgentTranscript,
})

type ToolEvent = {
  type: string
  tool?: string
  callId?: string
  ok?: boolean
}

/** Live transcript view for one agent's current run. */
function AgentTranscript() {
  const { agentId } = Route.useParams()
  const [text, setText] = useState('')
  const [events, setEvents] = useState<ToolEvent[]>([])
  const stream = useAgentStream({
    path: `/api/gateway/api/agents/${agentId}/events`,
    onDelta: (t) => setText((prev) => prev + t),
    onToolStarted: (tool, callId) =>
      setEvents((prev) => [...prev, { type: 'tool.started', tool, callId }]),
    onToolCompleted: (tool, ok, callId) =>
      setEvents((prev) => [...prev, { type: 'tool.completed', tool, ok, callId }]),
  })
  const isStreaming = !stream.lastError
  const [mountedAt] = useState(() => new Date().toISOString())

  useEffect(() => {
    document.title = `${agentId} — Orole-OS`
  }, [agentId])

  return (
    <main className="page-wrap px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle data-testid="agent-name">Agent: {agentId}</CardTitle>
          <CardDescription>
            Live transcript · streaming since {mountedAt}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {stream.lastError ? (
            <p role="alert" className="font-mono text-sm text-destructive">
              stream unavailable
            </p>
          ) : (
            <ul
              data-testid="transcript"
              aria-live="polite"
              className="space-y-2 font-mono text-sm"
            >
              {text && <li>{text}</li>}
              {events
                .filter((e) => e.type.startsWith('tool.'))
                .map((e, i) => (
                  <li key={i} data-testid="tool-event">
                    {e.type}: {e.tool}
                  </li>
                ))}
              {!isStreaming && !text && (
                <li className="text-[var(--muted-foreground)]">no activity</li>
              )}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  )
}

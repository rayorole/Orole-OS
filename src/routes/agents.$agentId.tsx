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

function getApiKey(): string | null {
  try {
    return window.localStorage.getItem('orole.apiKey')
  } catch {
    return null
  }
}

/** Live transcript view for one agent's current run. */
function AgentTranscript() {
  const { agentId } = Route.useParams()
  const apiKey = getApiKey()
  const stream = useAgentStream(`/api/agents/${agentId}/events`, apiKey)
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
          {stream.error ? (
            <p role="alert" className="font-mono text-sm text-destructive">
              stream unavailable
            </p>
          ) : (
            <ul
              data-testid="transcript"
              aria-live="polite"
              className="space-y-2 font-mono text-sm"
            >
              {stream.text && <li>{stream.text}</li>}
              {stream.events
                .filter((e) => e.type.startsWith('tool.'))
                .map((e, i) => (
                  <li key={i} data-testid="tool-event">
                    {e.type}: {(e as { tool?: string }).tool}
                  </li>
                ))}
              {!stream.isStreaming && !stream.text && (
                <li className="text-[var(--muted-foreground)]">no activity</li>
              )}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  )
}

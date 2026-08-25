// Shared domain types for the Orole-OS command-center dashboard.

export type AgentStatus = 'idle' | 'running' | 'thinking' | 'offline'

export interface AgentCard {
  id: string
  name: string
  status: AgentStatus
  currentTask: string | null
  lastActiveAt: string | null
}

export interface ActivityEvent {
  id: string
  agentId: string
  agentName: string
  kind: string
  message: string
  at: string
}

export interface TranscriptMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  at: string
}

export interface SessionSummary {
  id: string
  title: string
  agentId: string
  startedAt: string
  lastMessageAt: string
  messageCount: number
}

export interface KanbanColumn {
  id: string
  name: string
  cards: Array<{
    id: string
    title: string
    assignee: string | null
    updatedAt: string
  }>
}

export type TimeRange = '1h' | '24h' | '7d' | '30d'

export interface AnalyticsPoint {
  t: string // ISO timestamp bucket label
  tokens: number
  costUsd: number
  skillRuns: number
  mcpCalls: number
}

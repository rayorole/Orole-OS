/**
 * Star Map shared types + demo fleet (issue #28).
 * Kept separate from StarMap.tsx so the route can import types/data without
 * pulling three.js into its bundle.
 */

export type AgentStatus = 'running' | 'pending' | 'failed' | 'idle'
export type AgentRole = 'orchestrator' | 'coder' | 'reviewer'

export type StarMapAgent = {
  id: string
  name: string
  role: AgentRole
  status: AgentStatus
  /** 0..1 — recency/volume of activity; drives node size */
  activity: number
  /** current task label shown in tooltip */
  task?: string
}

export type DelegationEdge = {
  source: string // orchestrator id
  target: string // coder or reviewer id
  /** tokens over the current window; drives line thickness */
  tokenFlow: number
  /** true while the downstream agent is actively producing */
  active: boolean
}

export type StarMapProps = {
  agents: StarMapAgent[]
  edges: DelegationEdge[]
  /** puppet view (#27) open handler — click-through target */
  onSelectAgent?: (id: string) => void
}

/** Demo fleet until live Hermes API wiring lands (wave-4 integration). */
export const DEMO_AGENTS: StarMapAgent[] = [
  { id: 'jarvis-core', name: 'JARVIS core', role: 'orchestrator', status: 'running', activity: 1, task: 'fleet orchestration' },
  { id: 'planner-a', name: 'planner-alpha', role: 'orchestrator', status: 'running', activity: 0.8, task: 'wave-3 decomposition' },
  { id: 'coder-a', name: 'coder-one', role: 'coder', status: 'running', activity: 0.9, task: 'starmap renderer' },
  { id: 'coder-b', name: 'coder-two', role: 'coder', status: 'pending', activity: 0.35, task: 'queued: cost ticker' },
  { id: 'coder-c', name: 'coder-three', role: 'coder', status: 'idle', activity: 0.05 },
  { id: 'reviewer-a', name: 'reviewer-prime', role: 'reviewer', status: 'running', activity: 0.6, task: 'PR #32 review' },
  { id: 'reviewer-b', name: 'reviewer-two', role: 'reviewer', status: 'failed', activity: 0.25, task: 'lint gate failed' },
]

export const DEMO_EDGES: DelegationEdge[] = [
  { source: 'jarvis-core', target: 'coder-a', tokenFlow: 4200, active: true },
  { source: 'jarvis-core', target: 'coder-b', tokenFlow: 900, active: false },
  { source: 'jarvis-core', target: 'coder-c', tokenFlow: 120, active: false },
  { source: 'jarvis-core', target: 'reviewer-b', tokenFlow: 300, active: false },
  { source: 'planner-a', target: 'coder-a', tokenFlow: 2600, active: true },
  { source: 'planner-a', target: 'reviewer-a', tokenFlow: 1800, active: false },
]

/** sRGB approximations of the --status-* design tokens for WebGL materials. */
export const STATUS_COLOR: Record<AgentStatus, string> = {
  running: '#3ddc84',
  pending: '#f2b544',
  failed: '#e5484d',
  idle: '#8b93a1',
}

/** Orbit ring radii per role tier: orchestrators inner, coders middle, reviewers outer. */
export const ROLE_RING_RADIUS: Record<AgentRole, number> = {
  orchestrator: 4,
  coder: 7,
  reviewer: 10,
}

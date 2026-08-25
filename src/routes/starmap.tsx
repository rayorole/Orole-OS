import { lazy, Suspense } from 'react'
import { createFileRoute } from '@tanstack/react-router'

import { Badge } from '#/components/ui/badge'
import { DEMO_AGENTS, DEMO_EDGES } from '#/components/starmap/starmap-data'

// Code-split: three.js + react-three-fiber live in this chunk only.
const StarMap = lazy(() =>
  import('#/components/starmap/StarMap').then((m) => ({ default: m.StarMap })),
)

export const Route = createFileRoute('/starmap')({
  component: StarMapRoute,
})

function StarMapFallback() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <p className="hud-panel-title animate-pulse">booting star map…</p>
    </div>
  )
}

function StarMapRoute() {
  // Demo fleet until the Hermes API wiring lands (wave-4 integration).
  const agents = DEMO_AGENTS
  const edges = DEMO_EDGES

  return (
    <section className="hud-page flex flex-1 flex-col gap-4 py-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="m-0 font-mono text-lg font-semibold uppercase tracking-[0.2em] text-foreground">
            Star Map
          </h1>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            fleet delegation topology · orbit rings by role tier
          </p>
        </div>
        <Badge variant="outline" className="font-mono">
          {agents.length} nodes · {edges.length} edges
        </Badge>
      </header>

      <Suspense fallback={<StarMapFallback />}>
        <StarMap
          agents={agents}
          edges={edges}
          onSelectAgent={(id) => {
            // Puppet view (#27) click-through — wired once #27's route lands.
            window.dispatchEvent(new CustomEvent('orole:open-puppet', { detail: { id } }))
          }}
        />
      </Suspense>
    </section>
  )
}

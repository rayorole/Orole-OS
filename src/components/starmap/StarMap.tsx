/**
 * Star Map — 3D org-chart of the Orole agent fleet (issue #28).
 *
 * Jarvis core pulses at the center; agents orbit on role-tier rings
 * (orchestrators inner, coders middle, reviewers outer). Delegation edges
 * connect orchestrator → coder → reviewer; thickness ∝ token flow, edges
 * pulse while actively producing. Node size = recent activity, node color =
 * status palette from docs/design-system.md.
 *
 * This module is lazy-loaded behind /starmap so three.js never lands in the
 * main bundle. It renders only client-side; SSR sees the loading shell in
 * src/routes/starmap.tsx.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Html } from '@react-three/drei'
import * as THREE from 'three'

import { Badge } from '#/components/ui/badge'

import {
  type AgentRole,
  type StarMapAgent,
  type DelegationEdge,
  type StarMapProps,
  STATUS_COLOR,
  ROLE_RING_RADIUS,
} from './starmap-data'

/** Central Jarvis core — pulsing sphere. */
function Core() {
  const ref = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    if (!ref.current) return
    const t = clock.getElapsedTime()
    ref.current.scale.setScalar(1 + Math.sin(t * 2.4) * 0.12)
    const mat = ref.current.material as THREE.MeshStandardMaterial
    mat.emissiveIntensity = 1.6 + Math.sin(t * 2.4) * 0.6
  })
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.85, 32, 32]} />
      <meshStandardMaterial
        color="#22d3ee"
        emissive="#22d3ee"
        emissiveIntensity={1.8}
        roughness={0.25}
      />
    </mesh>
  )
}

/** Faint tier guide ring. */
function TierRing({ radius }: { radius: number }) {
  const points = useMemo(() => {
    const pts: THREE.Vector3[] = []
    for (let i = 0; i <= 96; i++) {
      const a = (i / 96) * Math.PI * 2
      pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius))
    }
    return new THREE.BufferGeometry().setFromPoints(pts)
  }, [radius])
  return (
    <line>
      <primitive object={points} attach="geometry" />
      <lineBasicMaterial color="#2a3040" transparent opacity={0.6} />
    </line>
  )
}

function AgentNode({
  agent,
  position,
  hovered,
  selected,
  onHover,
  onClick,
}: {
  agent: StarMapAgent
  position: [number, number, number]
  hovered: boolean
  selected: boolean
  onHover: (id: string | null) => void
  onClick: (id: string) => void
}) {
  const group = useRef<THREE.Group>(null)
  // Slow self-rotation for live feel; kept subtle to preserve 60fps.
  useFrame((_, delta) => {
    if (group.current) group.current.rotation.y += delta * 0.15
  })

  const size = 0.28 + agent.activity * 0.55
  const color = STATUS_COLOR[agent.status]
  const isLive = agent.status === 'running'

  return (
    <group position={position}>
      <group ref={group}>
        <mesh
          scale={hovered ? size * 1.25 : size}
          onPointerOver={(e) => {
            e.stopPropagation()
            onHover(agent.id)
          }}
          onPointerOut={() => onHover(null)}
          onClick={(e) => {
            e.stopPropagation()
            onClick(agent.id)
          }}
        >
          <sphereGeometry args={[1, 24, 24]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={isLive ? 1.2 : 0.35}
            roughness={0.4}
          />
        </mesh>
        {/* glow halo — reserved for live nodes per design-system glow rule */}
        {isLive && (
          <mesh scale={size * 1.7}>
            <sphereGeometry args={[1, 16, 16]} />
            <meshBasicMaterial color={color} transparent opacity={0.12} depthWrite={false} />
          </mesh>
        )}
        {(hovered || selected) && (
          <Html center distanceFactor={14} zIndexRange={[10, 0]}>
            <div className="pointer-events-none -translate-y-10 whitespace-nowrap rounded-md border border-border bg-background/95 px-2.5 py-1.5 font-mono text-[11px] shadow-lg backdrop-blur">
              <span className="font-semibold text-foreground">{agent.name}</span>
              <span className="mx-1.5 text-muted-foreground">·</span>
              <span className="uppercase tracking-wider text-muted-foreground">{agent.role}</span>
              {agent.task && (
                <div className="text-neon-cyan/80">{agent.task}</div>
              )}
            </div>
          </Html>
        )}
      </group>
    </group>
  )
}

function EdgeLine({ edge, from, to }: { edge: DelegationEdge; from: THREE.Vector3; to: THREE.Vector3 }) {
  const matRef = useRef<THREE.LineBasicMaterial>(null)

  const geometry = useMemo(
    () => new THREE.BufferGeometry().setFromPoints([from, to]),
    [from, to],
  )
  useEffect(() => () => geometry.dispose(), [geometry])

  // Thickness ∝ token flow: WebGL linewidth is capped at 1 on most platforms,
  // so encode flow via opacity/brightness and active-pulse instead.
  const intensity = Math.min(edge.tokenFlow / 4000, 1)
  const baseOpacity = 0.18 + intensity * 0.55

  useFrame(({ clock }) => {
    if (!matRef.current) return
    const t = clock.getElapsedTime()
    const pulse = edge.active ? 0.65 + Math.sin(t * 5) * 0.35 : 1
    matRef.current.opacity = baseOpacity * pulse
  })

  const color = edge.active ? '#22d3ee' : '#5b6474'

  return (
    <line>
      <primitive object={geometry} attach="geometry" />
      <lineBasicMaterial ref={matRef} color={color} transparent opacity={baseOpacity} />
    </line>
  )
}

/** Pauses the render loop when the tab is hidden (battery / CPU courtesy). */
function VisibilityPause() {
  const set = useThree((s) => s.set)
  useEffect(() => {
    const handler = () => set({ frameloop: document.hidden ? 'never' : 'always' })
    document.addEventListener('visibilitychange', handler)
    return () => {
      document.removeEventListener('visibilitychange', handler)
      set({ frameloop: 'always' })
    }
  }, [set])
  return null
}

export function StarMap({ agents, edges, onSelectAgent }: StarMapProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [webglSupported, setWebglSupported] = useState<boolean | null>(null)

  useEffect(() => {
    try {
      const canvas = document.createElement('canvas')
      const gl =
        canvas.getContext('webgl2') ??
        canvas.getContext('webgl') ??
        canvas.getContext('experimental-webgl')
      setWebglSupported(Boolean(gl))
    } catch {
      setWebglSupported(false)
    }
  }, [])

  // Ring layout computed once per fleet snapshot.
  const layout = useMemo(() => {
    const tierCounts: Record<AgentRole, number> = { orchestrator: 0, coder: 0, reviewer: 0 }
    agents.forEach((a) => tierCounts[a.role]++)
    const positions = new Map<string, THREE.Vector3>()
    const cursors: Record<AgentRole, number> = { orchestrator: 0, coder: 0, reviewer: 0 }
    for (const agent of agents) {
      const radius = ROLE_RING_RADIUS[agent.role]
      const angle = (cursors[agent.role]++ / Math.max(tierCounts[agent.role], 1)) * Math.PI * 2
      positions.set(
        agent.id,
        new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius),
      )
    }
    return positions
  }, [agents])

  const byId = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents])

  const handleSelect = (id: string) => {
    setSelectedId(id)
    onSelectAgent?.(id) // click-through to puppet view (#27)
  }

  if (webglSupported === null) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="hud-panel-title animate-pulse">initializing star map…</p>
      </div>
    )
  }

  if (webglSupported === false) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <Badge variant="pending">WebGL unavailable</Badge>
        <p className="max-w-md font-mono text-sm text-muted-foreground">
          Your browser can&apos;t create a WebGL context, so the 3D star map is disabled.
          Falling back to grid view.
        </p>
        <GridView agents={agents} onSelect={handleSelect} />
      </div>
    )
  }

  return (
    <div className="relative h-[calc(100vh-13rem)] min-h-[480px] w-full overflow-hidden rounded-lg border border-border bg-background/60">
      {/* HUD chrome */}
      <div className="pointer-events-none absolute left-4 top-4 z-10 flex flex-col gap-1">
        <p className="hud-panel-title m-0">star map · delegation topology</p>
        <div className="flex gap-3 font-mono text-[11px] text-muted-foreground">
          <LegendDot color={STATUS_COLOR.running} label="running" />
          <LegendDot color={STATUS_COLOR.pending} label="pending" />
          <LegendDot color={STATUS_COLOR.failed} label="failed" />
          <LegendDot color={STATUS_COLOR.idle} label="idle" />
        </div>
      </div>

      <Canvas
        camera={{ position: [0, 12, 16], fov: 50 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        style={{ background: 'transparent' }}
      >
        <VisibilityPause />
        <ambientLight intensity={0.5} />
        <pointLight position={[0, 8, 0]} intensity={40} color="#67e8f9" />

        <Core />
        {[ROLE_RING_RADIUS.orchestrator, ROLE_RING_RADIUS.coder, ROLE_RING_RADIUS.reviewer].map(
          (r) => (
            <TierRing key={r} radius={r} />
          ),
        )}

        {agents.map((agent) => (
          <AgentNode
            key={agent.id}
            agent={agent}
            position={
              (layout.get(agent.id) ?? new THREE.Vector3()).toArray() as [number, number, number]
            }
            hovered={hoveredId === agent.id}
            selected={selectedId === agent.id}
            onHover={setHoveredId}
            onClick={handleSelect}
          />
        ))}

        {edges.map((edge, i) => {
          const from = layout.get(edge.source)
          const to = layout.get(edge.target)
          if (!from || !to || edge.source === edge.target) return null
          return <EdgeLine key={`${edge.source}-${edge.target}-${i}`} edge={edge} from={from} to={to} />
        })}

        <OrbitControls
          enableDamping
          dampingFactor={0.08}
          minDistance={4}
          maxDistance={30}
          maxPolarAngle={Math.PI / 1.7}
        />
      </Canvas>

      {byId.get('jarvis-core') && (
        <p className="pointer-events-none absolute bottom-3 right-4 m-0 font-mono text-[11px] text-muted-foreground">
          drag to orbit · scroll to zoom · click a node for puppet view
        </p>
      )}
    </div>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block size-1.5 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      {label}
    </span>
  )
}

/** Accessible non-WebGL fallback grid. */
export function GridView({
  agents,
  onSelect,
}: {
  agents: StarMapAgent[]
  onSelect?: (id: string) => void
}) {
  return (
    <ul className="grid w-full max-w-3xl grid-cols-2 gap-2 p-4 sm:grid-cols-3">
      {agents.map((agent) => (
        <li key={agent.id}>
          <button
            type="button"
            onClick={() => onSelect?.(agent.id)}
            className="w-full rounded-md border border-border bg-card/60 px-3 py-2 text-left transition-colors hover:border-primary/50"
          >
            <span className="block font-mono text-xs font-semibold text-foreground">
              {agent.name}
            </span>
            <span className="mt-0.5 flex items-center justify-between font-mono text-[11px] text-muted-foreground">
              <span className="uppercase tracking-wider">{agent.role}</span>
              <Badge variant={agent.status}>{agent.status}</Badge>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

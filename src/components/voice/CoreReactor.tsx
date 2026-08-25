import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

import type { VoiceAmbientState } from '#/lib/voice-state'

/**
 * The holographic reactor core. Its color, pulse rate and ring rotation are
 * driven by the ambient voice state:
 *   idle      — calm cyan, slow breathing
 *   listening — cyan brightening, rings spin up, gentle pulse
 *   thinking  — violet, fast shimmer, counter-rotating rings
 *   speaking  — green-cyan, pulse follows speech cadence, rings expand
 *   error     — rose flicker
 */

const STATE_THEME: Record<
  VoiceAmbientState,
  { core: string; emissive: number; pulse: number; ringSpeed: number }
> = {
  idle: { core: '#22d3ee', emissive: 0.55, pulse: 0.9, ringSpeed: 0.25 },
  listening: { core: '#67e8f9', emissive: 1.1, pulse: 2.2, ringSpeed: 1.6 },
  thinking: { core: '#a78bfa', emissive: 0.95, pulse: 3.4, ringSpeed: -2.4 },
  speaking: { core: '#5eead4', emissive: 1.25, pulse: 4.2, ringSpeed: 1.1 },
  error: { core: '#fb7185', emissive: 1.4, pulse: 5.5, ringSpeed: -0.8 },
}

export function CoreReactor({ state }: { state: VoiceAmbientState }) {
  const group = useRef<THREE.Group>(null)
  const core = useRef<THREE.Mesh>(null)
  const innerRings = useRef<THREE.Group>(null)
  const outerRing = useRef<THREE.Group>(null)
  const particles = useRef<THREE.Points>(null)
  const theme = useRef(STATE_THEME.idle)

  // Smoothly chase the target theme so state changes feel organic.
  const current = useRef({ r: 0.13, g: 0.83, b: 0.93, emissive: 0.55 })

  useFrame((frameState, delta) => {
    const t = frameState.clock.elapsedTime
    const target = STATE_THEME[state] ?? STATE_THEME.idle

    const k = Math.min(1, delta * 3.5) // lerp factor toward the new state
    const targetColor = new THREE.Color(target.core)
    current.current.r += (targetColor.r - current.current.r) * k
    current.current.g += (targetColor.g - current.current.g) * k
    current.current.b += (targetColor.b - current.current.b) * k

    const color = new THREE.Color(current.current.r, current.current.g, current.current.b)
    const pulse = 1 + Math.sin(t * target.pulse) * 0.06

    if (core.current) {
      const mesh = core.current
      mesh.scale.setScalar(pulse)
      const mat = mesh.material as THREE.MeshStandardMaterial
      mat.color.lerp(color, k)
      mat.emissive.lerp(color, k)
      mat.emissiveIntensity += (target.emissive - mat.emissiveIntensity) * k
    }

    if (innerRings.current) {
      innerRings.current.rotation.y += delta * target.ringSpeed
      innerRings.current.rotation.x = Math.sin(t * 0.4) * 0.35
    }
    if (outerRing.current) {
      outerRing.current.rotation.z -= delta * target.ringSpeed * 0.6
      outerRing.current.rotation.y = Math.cos(t * 0.3) * 0.5
    }
    if (particles.current) {
      particles.current.rotation.y += delta * 0.12 * Math.sign(target.ringSpeed || 1)
      const pmat = particles.current.material as THREE.PointsMaterial
      pmat.color.lerp(color, k)
      pmat.size = 0.045 + Math.sin(t * target.pulse) * 0.012
    }
    if (group.current) {
      group.current.rotation.y += delta * 0.08
    }
  })

  return (
    <group ref={group}>
      {/* Wireframe reactor core */}
      <mesh ref={core}>
        <icosahedronGeometry args={[1, 2]} />
        <meshStandardMaterial
          wireframe
          transparent
          opacity={0.85}
          emissiveIntensity={theme.current.emissive}
        />
      </mesh>

      {/* Inner glow sphere */}
      <mesh scale={0.92}>
        <sphereGeometry args={[1, 24, 24]} />
        <meshBasicMaterial color="#22d3ee" transparent opacity={0.07} />
      </mesh>

      {/* Gyroscope rings */}
      <group ref={innerRings}>
        <mesh rotation={[Math.PI / 2.2, 0, 0]}>
          <torusGeometry args={[1.5, 0.02, 8, 96]} />
          <meshBasicMaterial color="#7dd3fc" transparent opacity={0.55} />
        </mesh>
        <mesh rotation={[Math.PI / 1.8, 0.4, 0]}>
          <torusGeometry args={[1.72, 0.014, 8, 96]} />
          <meshBasicMaterial color="#c4b5fd" transparent opacity={0.4} />
        </mesh>
      </group>
      <group ref={outerRing}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[2.05, 0.01, 8, 128]} />
          <meshBasicMaterial color="#67e8f9" transparent opacity={0.3} />
        </mesh>
      </group>

      {/* Particle shell */}
      <points ref={particles}>
        <sphereGeometry args={[2.4, 42, 42]} />
        <pointsMaterial size={0.045} color="#22d3ee" transparent opacity={0.65} sizeAttenuation />
      </points>

      <ambientLight intensity={0.4} />
      <pointLight position={[3, 3, 3]} intensity={30} color="#22d3ee" />
    </group>
  )
}

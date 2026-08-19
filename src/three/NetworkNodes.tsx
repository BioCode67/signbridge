import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { CITY_NODES, latLngToVector3, spreadLatLng } from '../data/networkNodes'
import { GLOBE_RADIUS } from './Globe'

/** Generate a soft radial-gradient texture once, reused by every halo sprite. */
function makeHaloTexture(): THREE.Texture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(103, 232, 249, 0.95)')
  g.addColorStop(0.25, 'rgba(34, 211, 238, 0.55)')
  g.addColorStop(1, 'rgba(34, 211, 238, 0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Base world-space size of a halo sprite (relative to the ~1.6-radius globe). */
const HALO_SIZE = 0.18

interface NetworkNodesProps {
  animate?: boolean
}

export default function NetworkNodes({ animate = true }: NetworkNodesProps) {
  const haloTexture = useMemo(makeHaloTexture, [])
  const halosRef = useRef<THREE.Group>(null)

  const nodes = useMemo(
    () =>
      CITY_NODES.map((c) => {
        const s = spreadLatLng(c)
        return {
          ...c,
          position: latLngToVector3(s.lat, s.lng, GLOBE_RADIUS * 1.012),
          scale: c.primary ? 1.5 : 1,
          phase: (c.lat + c.lng) % (Math.PI * 2),
        }
      }),
    [],
  )

  useFrame((state) => {
    if (!animate || !halosRef.current) return
    const t = state.clock.elapsedTime
    halosRef.current.children.forEach((child, i) => {
      const node = nodes[i]
      const pulse = 0.85 + Math.sin(t * 2 + node.phase) * 0.2
      child.scale.setScalar(HALO_SIZE * node.scale * pulse)
    })
  })

  return (
    <group>
      {/* Bright cores */}
      {nodes.map((n) => (
        <mesh key={`core-${n.id}`} position={n.position}>
          <sphereGeometry args={[0.03 * n.scale, 14, 14]} />
          <meshBasicMaterial color="#eafdff" toneMapped={false} />
        </mesh>
      ))}

      {/* Pulsing additive halos (billboarded sprites) */}
      <group ref={halosRef}>
        {nodes.map((n) => (
          <sprite key={`halo-${n.id}`} position={n.position} scale={HALO_SIZE * n.scale}>
            <spriteMaterial
              map={haloTexture}
              color="#22d3ee"
              transparent
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              toneMapped={false}
              opacity={0.9}
            />
          </sprite>
        ))}
      </group>
    </group>
  )
}

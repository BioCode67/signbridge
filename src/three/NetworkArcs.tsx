import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import * as THREE from 'three'
import {
  CITY_EDGES,
  CITY_NODES,
  buildArc,
  latLngToVector3,
  spreadLatLng,
} from '../data/networkNodes'
import { GLOBE_RADIUS } from './Globe'

interface NetworkArcsProps {
  animate?: boolean
  /** Higher = smoother arcs; lowered on mobile */
  segments?: number
}

export default function NetworkArcs({
  animate = true,
  segments = 64,
}: NetworkArcsProps) {
  const pulsesRef = useRef<THREE.Group>(null)

  const arcs = useMemo(() => {
    const byId = new Map(CITY_NODES.map((c) => [c.id, c]))
    return CITY_EDGES.map(([a, b], i) => {
      const na = spreadLatLng(byId.get(a)!)
      const nb = spreadLatLng(byId.get(b)!)
      const start = latLngToVector3(na.lat, na.lng, GLOBE_RADIUS * 1.012)
      const end = latLngToVector3(nb.lat, nb.lng, GLOBE_RADIUS * 1.012)
      const curve = buildArc(start, end, 0.32)
      return {
        id: `${a}-${b}`,
        curve,
        points: curve.getPoints(segments),
        // Stagger pulses + vary speed so the flow looks organic
        phase: (i * 0.37) % 1,
        speed: 0.16 + (i % 3) * 0.04,
      }
    })
  }, [segments])

  useFrame((state) => {
    if (!animate || !pulsesRef.current) return
    const t = state.clock.elapsedTime
    pulsesRef.current.children.forEach((child, i) => {
      const arc = arcs[i]
      const u = (t * arc.speed + arc.phase) % 1
      arc.curve.getPointAt(u, child.position as THREE.Vector3)
      // Fade in/out at the ends for a "comet" feel
      const fade = Math.sin(u * Math.PI)
      const mat = (child as THREE.Mesh).material as THREE.MeshBasicMaterial
      mat.opacity = 0.3 + fade * 0.7
      child.scale.setScalar(0.6 + fade * 0.8)
    })
  })

  return (
    <group>
      {arcs.map((arc) => (
        <Line
          key={arc.id}
          points={arc.points}
          color="#22d3ee"
          lineWidth={1}
          transparent
          opacity={0.28}
          toneMapped={false}
        />
      ))}

      {/* Traveling pulses */}
      <group ref={pulsesRef}>
        {arcs.map((arc) => (
          <mesh key={`pulse-${arc.id}`}>
            <sphereGeometry args={[0.022, 10, 10]} />
            <meshBasicMaterial
              color="#a5f3fc"
              transparent
              toneMapped={false}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
        ))}
      </group>
    </group>
  )
}

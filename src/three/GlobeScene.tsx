import { Suspense, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { EffectComposer, Bloom } from '@react-three/postprocessing'
import * as THREE from 'three'
import { useResponsive } from '../hooks/useResponsive'
import { latLngToVector3 } from '../data/networkNodes'
import Globe from './Globe'
import NetworkNodes from './NetworkNodes'
import NetworkArcs from './NetworkArcs'
import Starfield from './Starfield'

interface Quality {
  dpr: [number, number]
  stars: number
  bloomIntensity: number
  arcSegments: number
  spin: number
}

function qualityFor(
  breakpoint: 'mobile' | 'tablet' | 'desktop',
  reducedMotion: boolean,
): Quality {
  const base: Record<typeof breakpoint, Quality> = {
    mobile: { dpr: [1, 1.5], stars: 1400, bloomIntensity: 0.55, arcSegments: 36, spin: 0.05 },
    tablet: { dpr: [1, 1.6], stars: 2800, bloomIntensity: 0.75, arcSegments: 48, spin: 0.045 },
    desktop: { dpr: [1, 2], stars: 4500, bloomIntensity: 0.95, arcSegments: 64, spin: 0.04 },
  } as const
  const q = base[breakpoint]
  return reducedMotion ? { ...q, spin: 0 } : q
}

/** Everything that lives inside the Canvas. */
function SceneContents({ quality, animate }: { quality: Quality; animate: boolean }) {
  const groupRef = useRef<THREE.Group>(null)

  // Orient the globe so the Korean peninsula faces the camera (the KOREN
  // network is the focal point). Instead of a full spin — which would hide
  // Korea half the time — we gently swing around the vertical axis so the
  // network stays on screen yet the globe still feels alive.
  const baseQuat = useMemo(() => {
    // Aim the cluster centroid (≈ central Korea) at the camera, tilted slightly
    // up so the network sits in the upper-right of the globe.
    const centroid = latLngToVector3(35.72, 127.5, 1).normalize()
    const front = new THREE.Vector3(0, 0.18, 1).normalize()
    return new THREE.Quaternion().setFromUnitVectors(centroid, front)
  }, [])
  const yAxis = useMemo(() => new THREE.Vector3(0, 1, 0), [])
  const swing = useMemo(() => new THREE.Quaternion(), [])

  useFrame((state) => {
    if (!groupRef.current) return
    const angle = quality.spin > 0 ? Math.sin(state.clock.elapsedTime * 0.13) * 0.22 : 0
    swing.setFromAxisAngle(yAxis, angle)
    groupRef.current.quaternion.copy(swing).multiply(baseQuat)
  })

  return (
    <>
      {/* Key light from the camera side so Korea (front) stays lit, plus a
          cyan rim from the left limb and a soft fill. */}
      <ambientLight intensity={0.55} />
      <directionalLight position={[1, 2, 4.5]} intensity={2.0} color="#eaf2ff" />
      <directionalLight position={[-4.5, -0.5, 1]} intensity={1.1} color="#22d3ee" />
      <pointLight position={[2.5, 1.5, 3.5]} intensity={0.6} color="#67e8f9" />

      <Starfield count={quality.stars} animate={animate} />

      {/* Shifted right so the globe sits clear of the left-side copy. */}
      <group ref={groupRef} position={[0.8, 0, 0]}>
        <Globe />
        <NetworkArcs animate={animate} segments={quality.arcSegments} />
        <NetworkNodes animate={animate} />
      </group>

      <OrbitControls
        target={[0, 0, 0]}
        enableZoom={false}
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.45}
        minPolarAngle={Math.PI * 0.25}
        maxPolarAngle={Math.PI * 0.75}
      />

      <EffectComposer>
        <Bloom
          intensity={quality.bloomIntensity}
          luminanceThreshold={0.2}
          luminanceSmoothing={0.9}
          mipmapBlur
        />
      </EffectComposer>
    </>
  )
}

/**
 * Hero globe scene. Fills its parent; the parent controls height/positioning.
 * Quality (DPR, star count, bloom, arc detail, spin) scales with the device.
 */
export default function GlobeScene() {
  const { breakpoint, reducedMotion } = useResponsive()
  const quality = useMemo(
    () => qualityFor(breakpoint, reducedMotion),
    [breakpoint, reducedMotion],
  )
  const animate = !reducedMotion

  return (
    <Canvas
      dpr={quality.dpr}
      gl={{ antialias: true, powerPreference: 'high-performance', alpha: true }}
      camera={{ position: [0, 0, 4.7], fov: 45 }}
      style={{ width: '100%', height: '100%' }}
    >
      <Suspense fallback={null}>
        <SceneContents quality={quality} animate={animate} />
      </Suspense>
    </Canvas>
  )
}

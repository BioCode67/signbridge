import { Suspense, useEffect, useMemo } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, useGLTF } from '@react-three/drei'
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm'
import type { SignData } from './signTypes'
import { applyPoseToVRM, restPoseVRM } from './retarget'

const MODEL_URL = `${import.meta.env.BASE_URL}models/avatar.vrm`

// drei's loader uses three-stdlib's GLTF types while three-vrm expects the
// @types/three flavour; they're structurally identical at runtime, so we
// register the plugin through an `any`-typed shim to bypass the type clash.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const extendWithVRM = (loader: any) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  loader.register((parser: any) => new VRMLoaderPlugin(parser))

// Register the VRM plugin on drei's cached GLTF loader.
useGLTF.preload(MODEL_URL, true, true, extendWithVRM)

interface VRMModelProps {
  data?: SignData
  frame: number
  /** When false, the avatar holds a neutral rest pose (no retargeting). */
  animate: boolean
}

function VRMModel({ data, frame, animate }: VRMModelProps) {
  const gltf = useGLTF(MODEL_URL, true, true, extendWithVRM)
  const vrm = (gltf.userData as { vrm: VRM }).vrm

  // One-time setup: optimise, face the camera, relax into a rest pose.
  useMemo(() => {
    if (!vrm) return
    VRMUtils.removeUnnecessaryVertices(vrm.scene)
    VRMUtils.combineSkeletons(vrm.scene)
    vrm.scene.traverse((o) => {
      o.frustumCulled = false
    })
    // This VRM 1.0 model already faces +Z (toward the camera); no flip needed.
  }, [vrm])

  useFrame((state, delta) => {
    if (!vrm) return
    if (animate && data) applyPoseToVRM(vrm, data, frame)
    else restPoseVRM(vrm)
    // Periodic auto-blink for a touch of life (every ~4s, ~150ms close).
    const t = state.clock.elapsedTime
    const phase = t % 4
    const blink = phase > 3.85 ? Math.sin(((phase - 3.85) / 0.15) * Math.PI) : 0
    vrm.expressionManager?.setValue('blink', blink)
    // Subtle breathing on the spine (retargeting leaves the spine untouched).
    const spine = vrm.humanoid.getNormalizedBoneNode('spine')
    if (spine) spine.rotation.x = Math.sin(t * 1.4) * 0.012
    vrm.update(delta)
  })

  if (!vrm) return null
  return <primitive object={vrm.scene} />
}

/** Frames the upper body and gives a gentle cyan-lit studio look. */
function Rig() {
  const { camera } = useThree()
  useEffect(() => {
    camera.position.set(0, 1.25, 1.45)
    camera.lookAt(0, 1.15, 0)
  }, [camera])
  return null
}

interface Avatar3DProps {
  data?: SignData
  frame: number
  animate: boolean
}

/** R3F canvas hosting the rigged VRM avatar. Fills its parent. */
export default function Avatar3D({ data, frame, animate }: Avatar3DProps) {
  const dpr = useMemo<[number, number]>(() => {
    if (typeof window === 'undefined') return [1, 1.5]
    // Cap pixel ratio lower on phones to keep the WebGL frame budget healthy.
    const isMobile = window.innerWidth < 768
    return [1, Math.min(isMobile ? 1.5 : 2, window.devicePixelRatio)]
  }, [])
  return (
    <Canvas
      dpr={dpr}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      camera={{ fov: 30, near: 0.1, far: 20, position: [0, 1.25, 1.45] }}
      style={{ width: '100%', height: '100%' }}
    >
      <Rig />
      <ambientLight intensity={1.1} color="#cfe8ff" />
      <directionalLight position={[2, 3, 2]} intensity={1.8} color="#ffffff" />
      <directionalLight position={[-3, 1, -1]} intensity={0.9} color="#22d3ee" />
      <pointLight position={[0, 1.4, 1.6]} intensity={0.5} color="#67e8f9" />
      <Suspense fallback={null}>
        <VRMModel data={data} frame={frame} animate={animate} />
      </Suspense>
      <OrbitControls
        target={[0, 1.15, 0]}
        enablePan={false}
        enableZoom
        minDistance={0.8}
        maxDistance={3}
        minPolarAngle={Math.PI * 0.15}
        maxPolarAngle={Math.PI * 0.72}
        enableDamping
        dampingFactor={0.08}
      />
    </Canvas>
  )
}

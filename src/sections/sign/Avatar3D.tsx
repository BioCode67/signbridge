import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, Environment, Lightformer, OrbitControls, useGLTF } from '@react-three/drei'
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm'
import * as THREE from 'three'
import type { SignData } from './signTypes'
import { applyPoseToVRM, restPoseVRM } from './retarget'
import { prepareGLBRig, applyPoseToGLB, type GLBRig } from './glbRetarget'
import { DEFAULT_MODEL_URL } from './avatars'

/** Frame any humanoid so its head sits at a canonical height + upper body fills the stage. */
function frameScene(scene: THREE.Object3D, head: THREE.Object3D, hips: THREE.Object3D) {
  scene.scale.setScalar(1)
  scene.position.set(0, 0, 0)
  scene.updateWorldMatrix(true, true)
  const hp = head.getWorldPosition(new THREE.Vector3())
  const pp = hips.getWorldPosition(new THREE.Vector3())
  const TARGET_HEAD = 1.5, TARGET_HIPS = 0.92
  const s = (TARGET_HEAD - TARGET_HIPS) / Math.max(0.05, hp.y - pp.y)
  scene.scale.setScalar(s)
  scene.updateWorldMatrix(true, true)
  const hp2 = head.getWorldPosition(new THREE.Vector3())
  scene.position.x -= hp2.x
  scene.position.y += TARGET_HEAD - hp2.y
  scene.position.z -= hp2.z
}

const MODEL_URL = DEFAULT_MODEL_URL

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
  url: string
  data?: SignData
  frame: number
  /** When false, the avatar holds a neutral rest pose (no retargeting). */
  animate: boolean
}

function VRMModel({ url, data, frame, animate }: VRMModelProps) {
  const gltf = useGLTF(url, true, true, extendWithVRM)
  const vrm = (gltf.userData as { vrm?: VRM }).vrm
  const rigRef = useRef<GLBRig | null>(null)

  // One-time setup: VRM vs plain-GLB (Ready Player Me / Mixamo) humanoid.
  useMemo(() => {
    if (vrm) {
      rigRef.current = null
      VRMUtils.removeUnnecessaryVertices(vrm.scene)
      VRMUtils.combineSkeletons(vrm.scene)
      vrm.scene.traverse((o) => { o.frustumCulled = false })
      VRMUtils.rotateVRM0(vrm) // VRM0 faces -Z → face camera; no-op for VRM1
      const head = vrm.humanoid.getNormalizedBoneNode('head')
      const hips = vrm.humanoid.getNormalizedBoneNode('hips')
      if (head && hips) frameScene(vrm.scene, head, hips)
      return
    }
    // Realistic GLB humanoid
    const scene = gltf.scene
    scene.rotation.set(0, 0, 0)
    scene.traverse((o) => { o.frustumCulled = false })
    const rig = prepareGLBRig(scene)
    rigRef.current = rig
    if (rig.head && rig.hips) frameScene(scene, rig.head, rig.hips)
  }, [vrm, gltf])

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime
    if (vrm) {
      if (animate && data) applyPoseToVRM(vrm, data, frame)
      else restPoseVRM(vrm)
      const phase = t % 4
      const blink = phase > 3.85 ? Math.sin(((phase - 3.85) / 0.15) * Math.PI) : 0
      vrm.expressionManager?.setValue('blink', blink)
      const spine = vrm.humanoid.getNormalizedBoneNode('spine')
      if (spine) spine.rotation.x = Math.sin(t * 1.4) * 0.012
      vrm.update(delta)
      return
    }
    const rig = rigRef.current
    if (rig && animate && data) applyPoseToGLB(rig, data, frame)
  })

  return <primitive object={vrm ? vrm.scene : gltf.scene} />
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
  /** Which avatar model to load (defaults to the bundled VRoid). */
  modelUrl?: string
}

/** R3F canvas hosting the rigged VRM avatar. Fills its parent. */
export default function Avatar3D({ data, frame, animate, modelUrl = MODEL_URL }: Avatar3DProps) {
  const dpr = useMemo<[number, number]>(() => {
    if (typeof window === 'undefined') return [1, 1.5]
    // Cap pixel ratio lower on phones to keep the WebGL frame budget healthy.
    const isMobile = window.innerWidth < 768
    return [1, Math.min(isMobile ? 1.5 : 2, window.devicePixelRatio)]
  }, [])
  return (
    <Canvas
      dpr={dpr}
      shadows
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      camera={{ fov: 28, near: 0.1, far: 20, position: [0, 1.2, 1.5] }}
      style={{ width: '100%', height: '100%' }}
      onCreated={({ gl }) => {
        gl.toneMappingExposure = 1.12 // slightly brighter, more cinematic
      }}
    >
      <Rig />

      {/* Studio rig: warm key, cyan rim from behind for separation, soft fill. */}
      <ambientLight intensity={0.55} color="#dceaff" />
      <directionalLight
        position={[2.5, 3.5, 2.5]}
        intensity={2.4}
        color="#fff6ec"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0004}
      />
      <directionalLight position={[-3, 1.6, -2.2]} intensity={1.6} color="#22d3ee" />
      <directionalLight position={[3, 1.2, -2]} intensity={0.8} color="#a5f3fc" />
      <pointLight position={[0, 1.5, 1.8]} intensity={0.4} color="#ffffff" />

      {/* Image-based lighting for clean speculars on eyes / glossy bits. */}
      <Environment resolution={64}>
        <Lightformer intensity={2.2} color="#ffffff" position={[2, 3, 2]} scale={[4, 4, 1]} />
        <Lightformer intensity={1.1} color="#22d3ee" position={[-4, 1, -2]} scale={[5, 5, 1]} />
        <Lightformer intensity={0.7} color="#67e8f9" position={[0, 2, -4]} scale={[6, 3, 1]} />
      </Environment>

      <Suspense fallback={null}>
        <VRMModel key={modelUrl} url={modelUrl} data={data} frame={frame} animate={animate} />
        {/* Soft contact shadow grounds the figure. */}
        <ContactShadows
          position={[0, 0.0, 0]}
          opacity={0.45}
          scale={4}
          blur={2.6}
          far={2}
          color="#04111a"
        />
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

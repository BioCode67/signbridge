import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, Environment, Lightformer, OrbitControls, useGLTF } from '@react-three/drei'
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm'
import * as THREE from 'three'
import type { SignData } from './signTypes'
import { applyPoseToVRM, restPoseVRM, prepareVRMRig } from './retarget'
import { prepareGLBRig, applyPoseToGLB, setBlinkGLB, type GLBRig } from './glbRetarget'
import { DEFAULT_MODEL_URL } from './avatars'

/** Frame any humanoid so its head sits at a canonical height + upper body fills the stage. */
function frameScene(scene: THREE.Object3D, head: THREE.Object3D, hips: THREE.Object3D) {
  scene.scale.setScalar(1)
  scene.position.set(0, 0, 0)
  scene.updateWorldMatrix(true, true)
  const hp = head.getWorldPosition(new THREE.Vector3())
  const pp = hips.getWorldPosition(new THREE.Vector3())
  const TARGET_HEAD = 1.45, TARGET_HIPS = 0.9
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
  /** 고개의 원래 자세 — 고개 동작을 절대값으로 주기 위해 한 번만 기억한다. */
  const headRestRef = useRef<THREE.Euler | null>(null)

  // One-time setup: VRM vs plain-GLB (Ready Player Me / Mixamo) humanoid.
  useMemo(() => {
    if (vrm) {
      rigRef.current = null
      headRestRef.current = null
      VRMUtils.removeUnnecessaryVertices(vrm.scene)
      VRMUtils.combineSkeletons(vrm.scene)
      vrm.scene.traverse((o) => { o.frustumCulled = false })
      VRMUtils.rotateVRM0(vrm) // VRM0 faces -Z → face camera; no-op for VRM1
      prepareVRMRig(vrm) // capture true rest axes so A-pose models retarget correctly
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
    headRestRef.current = null
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
    if (rig) {
      if (animate && data) applyPoseToGLB(rig, data, frame)
      const phase = t % 4.2
      const blink = phase > 4.05 ? Math.sin(((phase - 4.05) / 0.15) * Math.PI) : 0
      setBlinkGLB(rig, blink)
      // 고개 동작 — **절대값으로 준다.** 매 프레임 더하면 흔들림이 쌓여 고개가
      // 돌아가 버린다. 처음 자세를 한 번 기억해 두고 거기서 얼마나 돌릴지 정한다.
      if (rig.head) {
        if (!headRestRef.current) {
          headRestRef.current = rig.head.rotation.clone()
        }
        const rest = headRestRef.current
        const off = animate ? headOffset(data, frame) : { x: 0, y: 0 }
        rig.head.rotation.set(rest.x + off.x, rest.y + off.y, rest.z)
      }
    }
  })

  return <primitive object={vrm ? vrm.scene : gltf.scene} />
}

/** 지금 프레임에서 고개를 얼마나 움직일지 — 부정은 젓고, 당부는 끄덕인다.
 *
 * **왜 손만으로는 모자란가.** 수어에서 부정은 손 모양이 아니라 **고개 젓기**로
 * 나른다. 그게 없으면 "안 됩니다"가 "됩니다"와 같은 모양으로 보인다 —
 * 밋밋한 정도가 아니라 뜻이 반대로 읽힐 수 있다.
 *
 * 어느 낱말에 붙일지는 원본 비수지 주석에서 쟀다(문장 200,873건). 방향이 데이터에
 * 있는 것(고개)만 쓰고, 눈썹은 올림/찌푸림이 주석에 없어 건드리지 않는다.
 *
 * 움직임은 낱말 구간 안에서 시작·끝이 0이 되게(사인 포락선) 부드럽게 넣는다 —
 * 갑자기 튀면 그것대로 어색하다. */
function headOffset(data: SignData | undefined, frame: number): { x: number; y: number } {
  if (!data?.gloss_sequence?.length) return { x: 0, y: 0 }
  const t = frame / (data.fps || 30)
  const g = data.gloss_sequence.find((x) => x.head && t >= x.start && t <= x.end)
  if (!g?.head) return { x: 0, y: 0 }
  const span = Math.max(0.25, g.end - g.start)
  const u = Math.min(1, Math.max(0, (t - g.start) / span))
  const wave = Math.sin(u * Math.PI * 2 * 1.5)   // 구간 안에서 1.5번 왕복
  const ease = Math.sin(u * Math.PI)             // 시작·끝에서 0
  const a = wave * ease
  return g.head === 'nod' ? { x: a * 0.13, y: 0 } : { x: 0, y: a * 0.17 }
}

/** Frames the upper body and gives a gentle cyan-lit studio look. */
function Rig() {
  const { camera, size, controls } = useThree()
  useEffect(() => {
    // **수어 공간이 다 들어와야 한다.**
    //
    // 예전 값(fov 30 · 거리 1.95 · 중심 y 1.05)은 세로로 약 1.05m만 담아서
    // y 0.53~1.57 사이만 보였다. 손을 머리 위로 올리는 동작(높다·비·하늘·안녕 일부)
    // 에서 **손이 화면 밖으로 나갔다** — 수어에서 손 위치는 뜻의 일부라 잘리면
    // 그 문장은 읽을 수 없다. 실측 사진에서 창구 화면의 아바타가 그렇게 잘려 있었다.
    //
    // 지금 값은 세로 약 1.34m(y 0.57~1.91)를 담는다. 아바타가 조금 작아지지만
    // **잘린 손보다 작은 손이 낫다.**
    // **가로도 세로와 같은 문제가 있다.** fov는 세로 기준이라, 세로로 긴 화면
    // (폰 세로)에서는 가로 시야가 오히려 좁아진다. 실측(폰 390px, 받기 화면):
    //
    //     y=500 줄의 아바타 구간 → [141~251] 몸통, [334~388] **오른손**
    //     화면은 389에서 끝난다 → 손가락이 잘린다
    //
    // 몸통과 떨어진 덩어리라 어깨가 아니라 손이다. 수어에서 손 모양은 뜻 그 자체라
    // 잘리면 그 낱말은 못 읽는다. 세로를 고쳤을 때와 똑같은 이유다.
    //
    // 담고 싶은 가로 폭을 정해 두고 화면 비율에 맞춰 카메라를 물린다.
    // 넓은 화면(태블릿 가로·키오스크)에서는 지금 거리를 그대로 쓴다 — 공연히
    // 작아질 이유가 없다.
    const WIDE = 1.4                       // 담고 싶은 가로 폭(m)
    const aspect = size.height > 0 ? size.width / size.height : 1
    const fov = (camera as THREE.PerspectiveCamera).fov
    const half = Math.tan((fov * Math.PI) / 360)
    const need = WIDE / (2 * Math.max(0.2, aspect) * half)
    const z = Math.max(2.0, Math.min(3.2, need))

    // 카메라를 물리면 **세로도 함께 넓어진다.** 그대로 두면 머리 위가 텅 빈다
    // (실측: 무대 세로의 40%가 빈 공간이었다). 위쪽 경계를 예전에 맞춰 둔 값
    // (y 1.91 — 손을 머리 위로 올리는 동작이 들어가는 높이)에 고정하고, 늘어난
    // 만큼은 아래(다리 쪽)로 보낸다. 빈 하늘보다 몸이 보이는 편이 낫다.
    // 위쪽 경계 — **예전 값 1.91이 맞았다.**
    //
    // 중간에 "머리 위가 187px 비었다"고 보고 1.6으로 내렸는데, 그 187px은
    // OrbitControls가 시선을 되돌리는 바람에 생긴 **고장 난 프레이밍**에서 잰
    // 값이었다. target까지 옮기고 나서 1.6으로 재니 머리가 화면 맨 위에 붙었다
    // (여백 0px) — 손을 머리 위로 올리는 동작이 곧바로 잘린다.
    //
    // 고장 난 상태에서 잰 값으로 기준을 바꾸면 안 된다. 고치고 나서 다시 잰다.
    const TOP_Y = 1.91
    const halfH = z * half                 // 이 거리에서 보이는 세로 절반(m)
    const centerY = TOP_Y - halfH
    camera.position.set(0, centerY + 0.04, z)
    camera.lookAt(0, centerY, 0)

    // **OrbitControls가 매 프레임 시선을 자기 target으로 되돌린다.** 여기서 카메라만
    // 옮기면 세로 조정이 통째로 무효가 된다 — 실제로 위쪽 경계를 1.91에서 1.6으로
    // 내렸는데 화면이 1px도 안 움직였다(빌드에는 값이 들어 있었다). 손으로 돌려
    // 보는 기능은 살려야 하므로 컨트롤을 없애지 않고 **target을 같이 옮긴다.**
    const orbit = controls as { target?: THREE.Vector3; update?: () => void } | null
    if (orbit?.target) {
      orbit.target.set(0, centerY, 0)
      orbit.update?.()
    }
  }, [camera, controls, size.width, size.height])
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
      camera={{ fov: 37, near: 0.1, far: 20, position: [0, 1.28, 2.0] }}
      style={{ width: '100%', height: '100%' }}
      onCreated={({ gl }) => {
        gl.toneMappingExposure = 1.0 // neutral exposure for realistic skin (no wash-out)
      }}
    >
      <Rig />

      {/* Neutral studio rig tuned for realistic PBR skin: soft white key + fill,
          and only a faint cyan rim for separation (no cyan cast on the face). */}
      <ambientLight intensity={0.8} color="#eef4ff" />
      <directionalLight
        position={[2, 3, 3]}
        intensity={2.0}
        color="#fff4ea"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0004}
      />
      <directionalLight position={[-2.5, 1.4, 1.5]} intensity={0.7} color="#ffffff" />
      <directionalLight position={[-3, 1.8, -2.5]} intensity={0.5} color="#22d3ee" />

      {/* Image-based lighting for soft, realistic skin + clean eye speculars. */}
      <Environment resolution={128}>
        <Lightformer intensity={1.6} color="#ffffff" position={[2, 3, 2]} scale={[5, 5, 1]} />
        <Lightformer intensity={1.0} color="#fff0e6" position={[-3, 1, 2]} scale={[5, 5, 1]} />
        <Lightformer intensity={0.5} color="#22d3ee" position={[0, 2, -4]} scale={[6, 3, 1]} />
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
        makeDefault
        target={[0, 1.24, 0]}
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

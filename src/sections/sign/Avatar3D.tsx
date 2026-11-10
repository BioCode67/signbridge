import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, Environment, Lightformer, OrbitControls, useGLTF } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette, N8AO } from '@react-three/postprocessing'
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

  /** 프레임 사이 메우기 — 수어 데이터는 초당 30장인데 폰 화면은 60~120번 그린다.
   *  정수 프레임만 쓰면 같은 자세를 두세 번 그리다 툭 넘어가는 계단이 생긴다.
   *  다음 프레임이 언제 올지는 **직전 간격**으로 어림한다(느린 재생·느린 기기도 따라간다).
   *  멈춰 있으면 다음 프레임까지만 가고 더 나가지 않는다. */
  const frac = useRef({ frame: -1, at: 0, interval: 1 / 30 })
  const subFrame = (t: number, d: SignData | undefined): number => {
    const fr = frac.current
    if (frame !== fr.frame) {
      if (fr.frame >= 0 && frame > fr.frame) {
        fr.interval = Math.min(0.5, Math.max(1 / 240, (t - fr.at) / (frame - fr.frame)))
      }
      fr.frame = frame
      fr.at = t
    }
    if (!d || !animate) return frame
    const u = Math.min(1, (t - fr.at) / fr.interval)
    return Math.min(d.num_frames - 1, frame + u)
  }

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
    if (rig) stepGLB(rig, headRestRef, data, subFrame(t, data), animate, t, delta)
  })

  // 계측(자동 검사 전용) — `window.__SB_PROBE`가 있을 때만 붙는다. 평소에는 아무 일도 안 한다.
  const { camera, size } = useThree()
  const dataRef = useRef(data)
  useEffect(() => {
    dataRef.current = data
  }, [data])
  useEffect(() => {
    const w = window as unknown as { __SB_PROBE?: unknown; __sbAvatar?: unknown }
    if (!w.__SB_PROBE || vrm || !rigRef.current) return
    const rig = rigRef.current
    void import('./avatarProbe').then(({ attachProbe }) => {
      w.__sbAvatar = attachProbe({
        scene: gltf.scene,
        camera,
        size,
        getData: () => dataRef.current,
        step: (d, f, t, dt) => stepGLB(rig, headRestRef, d, f, true, t, dt),
        fractional: true,
      })
    })
  }, [vrm, gltf, camera, size])

  return <primitive object={vrm ? vrm.scene : gltf.scene} />
}

/** GLB 아바타 한 번 갱신 — 화면 루프와 계측이 **같은 함수**를 쓴다.
 *
 *  `frame`은 소수일 수 있다(화면이 데이터보다 자주 그릴 때 프레임 사이를 메운다).
 *  `dt`는 지난 갱신과의 간격(초) — 평활 세기를 주사율과 무관하게 맞추는 데 쓴다. */
function stepGLB(
  rig: GLBRig,
  headRestRef: { current: THREE.Euler | null },
  data: SignData | undefined,
  frame: number,
  animate: boolean,
  t: number,
  dt: number,
) {
  // 숨쉬기 — **팔을 맞추기 전에** 가슴을 움직인다. 팔은 어깨의 실제 자세를 기준으로
  // 방향을 잡으므로, 순서를 바꾸면 손이 숨 따라 흔들린다(손 위치는 수어의 뜻이다).
  breathe(rig, t)
  if (animate && data) applyPoseToGLB(rig, data, frame, dt)
  setBlinkGLB(rig, blinkAt(t))
  // 고개 동작 — **절대값으로 준다.** 매 프레임 더하면 흔들림이 쌓여 고개가
  // 돌아가 버린다. 처음 자세를 한 번 기억해 두고 거기서 얼마나 돌릴지 정한다.
  if (rig.head) {
    if (!headRestRef.current) {
      headRestRef.current = rig.head.rotation.clone()
    }
    const rest = headRestRef.current
    const off = animate ? headOffset(data, frame) : { x: 0, y: 0 }
    // 살아 있는 사람의 고개는 완전히 멈춰 있지 않다 — 아주 작게(±0.5° 남짓) 천천히 흔든다.
    // 끄덕임(±7.4°)·젓기(±9.7°)보다 한 자릿수 작아 그 뜻을 흐리지 않는다.
    const mx = 0.006 * Math.sin(t * 1.31) + 0.004 * Math.sin(t * 2.17 + 1.3)
    const my = 0.008 * Math.sin(t * 0.83 + 0.4) + 0.004 * Math.sin(t * 1.91)
    rig.head.rotation.set(rest.x + off.x + mx, rest.y + off.y + my, rest.z)
  }
}

/** 숨쉬기 — 가슴(Spine1·Spine2)을 4.2초 주기로 아주 조금(최대 0.7°) 젖힌다.
 *  가만히 선 아바타가 "멈춘 그림"처럼 보이는 가장 큰 이유가 숨을 안 쉬는 것이다. */
const _bq = new THREE.Quaternion()
const _ax = new THREE.Vector3(1, 0, 0)
function breathe(rig: GLBRig, t: number) {
  const b = Math.sin((t * 2 * Math.PI) / 4.2)
  for (const [bone, rest, amp] of rig.spine) {
    _bq.setFromAxisAngle(_ax, -b * amp)
    bone.quaternion.copy(rest).multiply(_bq)
  }
}

/** 눈 깜박임 — 2.2~5.5초 사이 들쭉날쭉한 간격, 가끔(15%) 두 번 연달아.
 *
 *  예전에는 4.2초마다 정확히 한 번이었다. 사람은 그렇게 깜박이지 않아서, 오래 보면
 *  기계가 시계에 맞춰 깜박이는 것처럼 보인다. 감는 데 70ms, 뜨는 데 150ms —
 *  실제 깜박임도 감을 때가 빠르다. 간격은 시드 고정 난수라 계측 때마다 같다. */
const blinkTimes: number[] = []
let blinkSeed = 12345
function rand() {
  blinkSeed = (blinkSeed * 1103515245 + 12345) & 0x7fffffff
  return blinkSeed / 0x7fffffff
}
function blinkAt(t: number): number {
  while (!blinkTimes.length || blinkTimes[blinkTimes.length - 1] < t + 6) {
    const last = blinkTimes.length ? blinkTimes[blinkTimes.length - 1] : 0.8
    const next = last + 2.2 + rand() * 3.3
    blinkTimes.push(next)
    if (rand() < 0.15) blinkTimes.push(next + 0.32)
  }
  const tm = t % 100000
  for (let i = blinkTimes.length - 1; i >= 0; i--) {
    const s = blinkTimes[i]
    if (s > tm) continue
    const u = tm - s
    if (u > 0.25) return 0
    if (u < 0.07) return Math.sin((u / 0.07) * (Math.PI / 2))
    if (u < 0.1) return 1
    return Math.cos(((u - 0.1) / 0.15) * (Math.PI / 2))
  }
  return 0
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

/** Subtle circular gradient platform — grounds the avatar on a professional stage. */
function StagePlatform() {
  const mesh = useRef<THREE.Mesh>(null)
  const geo = useMemo(() => new THREE.CircleGeometry(1.2, 64), [])
  const mat = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 256
    const ctx = canvas.getContext('2d')!
    const grad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128)
    grad.addColorStop(0, 'rgba(34,211,238,0.08)')
    grad.addColorStop(0.5, 'rgba(20,100,120,0.04)')
    grad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, 256, 256)
    const tex = new THREE.CanvasTexture(canvas)
    return new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
  }, [])
  return <mesh ref={mesh} rotation-x={-Math.PI / 2} position={[0, 0.001, 0]} geometry={geo} material={mat} />
}

/** Frames the upper body and gives a gentle cyan-lit studio look. */
function Rig({ bottomInset = 0 }: { bottomInset?: number }) {
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
    // **자막 띠 아래로 손이 숨으면 안 된다.** 당사자 화면은 무대 아래쪽에 자막·낱말
    // 진행을 얹는다(폰 164px, 데스크톱 146px). 그 밑으로 내려간 손은 그려져도 안 보인다.
    // 실측: 데스크톱에서 수어하는 손(오른손)이 4.4% 프레임에서 띠 밑에 있었다.
    // 그래서 띠를 뺀 나머지 높이에 TOP_Y~BOTTOM_Y가 들어가도록 카메라를 물린다.
    // BOTTOM_Y 0.80m는 실측한 오른손 가장 낮은 점의 하위 5% 높이(0.79~0.80m)다.
    const BOTTOM_Y = 0.8
    const visH = Math.max(0.3, (size.height - bottomInset) / Math.max(1, size.height))
    const needV = bottomInset > 0 ? (1.91 - BOTTOM_Y) / (visH * 2 * half) : 0
    const z = Math.max(2.0, Math.min(3.2, Math.max(need, needV)))

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
  }, [camera, controls, size.width, size.height, bottomInset])
  return null
}

interface Avatar3DProps {
  data?: SignData
  frame: number
  animate: boolean
  /** Which avatar model to load (defaults to the bundled VRoid). */
  modelUrl?: string
  /** 캔버스 아래쪽을 가리는 자막 띠 높이(px). 손이 그 위에 오도록 카메라를 물린다. */
  bottomInset?: number
}

/** R3F canvas hosting the rigged VRM avatar. Fills its parent. */
export default function Avatar3D({ data, frame, animate, modelUrl = MODEL_URL, bottomInset = 0 }: Avatar3DProps) {
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
        gl.toneMapping = THREE.ACESFilmicToneMapping
        gl.toneMappingExposure = 1.05
      }}
    >
      <Rig bottomInset={bottomInset} />

      {/* Professional 3-point studio lighting for realistic PBR skin.
          Key (warm white) + Fill (neutral) + Rim (cyan accent) + Hair light. */}
      <ambientLight intensity={0.6} color="#f0f4ff" />
      {/* Key light — warm, main illumination from front-right */}
      <directionalLight
        position={[2.5, 3.5, 3]}
        intensity={2.2}
        color="#fff2e0"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0003}
        shadow-radius={4}
      />
      {/* Fill light — softer, from front-left */}
      <directionalLight position={[-2.5, 1.8, 2]} intensity={0.8} color="#f5f0ff" />
      {/* Rim/back light — cyan accent for silhouette separation */}
      <directionalLight position={[-2, 2.5, -3]} intensity={0.7} color="#22d3ee" />
      {/* Hair/top light — subtle overhead for depth */}
      <directionalLight position={[0.5, 4, 0]} intensity={0.4} color="#ffffff" />

      {/* Image-based lighting for soft, realistic skin + clean eye speculars. */}
      <Environment resolution={256}>
        <Lightformer intensity={1.8} color="#ffffff" position={[2, 3, 2]} scale={[5, 5, 1]} />
        <Lightformer intensity={1.2} color="#fff0e6" position={[-3, 1, 2]} scale={[5, 5, 1]} />
        <Lightformer intensity={0.6} color="#22d3ee" position={[0, 2.5, -4]} scale={[8, 4, 1]} />
        <Lightformer intensity={0.3} color="#e0f0ff" position={[0, 4, 0]} scale={[10, 1, 1]} rotation-x={Math.PI / 2} />
      </Environment>

      <Suspense fallback={null}>
        <VRMModel key={modelUrl} url={modelUrl} data={data} frame={frame} animate={animate} />
        <StagePlatform />
        {/* Soft contact shadow grounds the figure. */}
        <ContactShadows
          position={[0, 0.0, 0]}
          opacity={0.5}
          scale={4}
          blur={2.4}
          far={2.5}
          color="#041520"
        />
      </Suspense>

      {/* Post-processing: subtle cinematic polish without killing performance. */}
      <EffectComposer multisampling={0}>
        <N8AO aoRadius={0.5} intensity={1.0} distanceFalloff={0.8} halfRes />
        <Bloom luminanceThreshold={0.9} luminanceSmoothing={0.4} intensity={0.15} mipmapBlur />
        <Vignette offset={0.3} darkness={0.4} />
      </EffectComposer>

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

/**
 * Retargeting for plain glTF humanoid skeletons (Ready Player Me, Mixamo) —
 * realistic avatars that aren't VRM. Unlike the VRM path (normalised T-pose,
 * ±X rest axes), here each bone's rest "forward" is read from the bind pose,
 * so any standard rig works. Bone names are matched by suffix after stripping
 * a `mixamorig:` / `mixamorig2:` prefix.
 */
import * as THREE from 'three'
import type { SignData } from './signTypes'
import { segDir, segDir3D, segDir3Dreal, restLen, smoothInto } from './retarget'
// 손모양 정의는 handShape.ts 한 곳에만 둔다 — 검사 스크립트가 같은 함수를 쓴다.
import { FINGERS, HAND_SEGS, FLEX_SHARE, curlOf } from './handShape'

const RSH = 2, REL = 3, RWR = 4
const LSH = 5, LEL = 6, LWR = 7
// Higher = tighter tracking of the actual sign (less lag), lower = smoother.
// Tuned up from 0.4/0.16 so hand-shapes reach the keypoint pose more faithfully.
const SMOOTH = 0.46, SMOOTH_FINGER = 0.26
const ARM_MAX = 2.7

// Map our logical bone keys → RPM/Mixamo bone-name suffix.

interface BoneInfo {
  bone: THREE.Object3D
  axis: THREE.Vector3 // rest forward in the bone's local frame
  bind: THREE.Quaternion
  smooth: THREE.Quaternion
  flex?: THREE.Vector3 // finger flexion axis (knuckle axis) in bone-local frame
  abduct?: THREE.Vector3 // MCP spread axis (palm normal) in bone-local frame
  restLat?: number // rest lateral angle of this finger in the hand plane (rad)
}
const FINGER_FLEX_MAX = 1.5 // cap per-joint curl (~86°)
const FINGER_SPREAD_MAX = 0.42 // 네 손가락 MCP 벌림 한계 (~24°)
// 엄지는 실제로 더 크게 벌어진다(대립 자세). 다만 잘못 놓이면 가장 눈에 띄므로
// 해부학 범위보다 좁게 잡는다.
const THUMB_SPREAD_MAX = 0.55 // ~32°
/** 잰 벌림을 얼마나 믿을까. 실측 신호비(낱말 사이 σ ÷ 떨림 σ)가 2.5~3.2였고,
 *  s²/(s²+n²)이 0.87~0.91로 나왔다. 그 아래쪽을 쓴다. */
const SPREAD_TRUST = 0.88

export interface GLBRig {
  get(key: string): BoneInfo | undefined
  head?: THREE.Object3D
  hips?: THREE.Object3D
  faceMeshes: THREE.Mesh[]
  /** Per-hand rest frame (in hand-local space): forward / palm-normal / side. */
  handFrame: Map<string, { fwd: THREE.Vector3; normal: THREE.Vector3; side: THREE.Vector3 }>
}

function clean(name: string): string {
  // three.js GLTFLoader strips ':' so "mixamorig2:RightArm" → "mixamorig2RightArm".
  return name.replace(/^mixamorig\d*:?/i, '')
}

/** Build a rig: find bones by suffix, capture each driven bone's rest axis. */
export function prepareGLBRig(root: THREE.Object3D): GLBRig {
  const byName = new Map<string, THREE.Object3D>()
  const faceMeshes: THREE.Mesh[] = []
  root.updateWorldMatrix(true, true)
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone || o.type === 'Bone') byName.set(clean(o.name), o)
    const m = o as THREE.Mesh
    if (m.isMesh && m.morphTargetDictionary) faceMeshes.push(m)
  })

  const infos = new Map<string, BoneInfo>()
  const childOf: Record<string, string> = {}
  // arm chains
  for (const s of ['Left', 'Right']) {
    childOf[`${s}Arm`] = `${s}ForeArm`
    childOf[`${s}ForeArm`] = `${s}Hand`
    for (const fg of FINGERS) {
      childOf[`${s}Hand${fg}1`] = `${s}Hand${fg}2`
      childOf[`${s}Hand${fg}2`] = `${s}Hand${fg}3`
    }
  }
  const make = (key: string, name: string, childName?: string) => {
    const bone = byName.get(name)
    if (!bone) return
    // rest forward = direction to child in this bone's local space
    let axis = new THREE.Vector3(0, 1, 0)
    const child = childName ? byName.get(childName) : undefined
    if (child && child.parent === bone) {
      axis = child.position.clone()
    } else if (bone.children.length) {
      const c = bone.children.find((x) => (x as THREE.Bone).isBone)
      if (c) axis = (c as THREE.Object3D).position.clone()
    }
    if (axis.lengthSq() < 1e-8) axis.set(0, 1, 0)
    axis.normalize()
    infos.set(key, { bone, axis, bind: bone.quaternion.clone(), smooth: bone.quaternion.clone() })
  }

  for (const s of ['Left', 'Right']) {
    make(`${s}Arm`, `${s}Arm`, `${s}ForeArm`)
    make(`${s}ForeArm`, `${s}ForeArm`, `${s}Hand`)
    make(`${s}Hand`, `${s}Hand`, `${s}HandMiddle1`)
    for (const fg of FINGERS) {
      make(`${s}Hand${fg}1`, `${s}Hand${fg}1`, childOf[`${s}Hand${fg}1`])
      make(`${s}Hand${fg}2`, `${s}Hand${fg}2`, childOf[`${s}Hand${fg}2`])
      make(`${s}Hand${fg}3`, `${s}Hand${fg}3`)
    }
  }
  make('Neck', 'Neck', 'Head')

  // Hand rest frame: forward (→middle MCP), side (index→pinky), palm normal.
  const handFrame = new Map<string, { fwd: THREE.Vector3; normal: THREE.Vector3; side: THREE.Vector3 }>()
  for (const s of ['Left', 'Right']) {
    const mid = byName.get(`${s}HandMiddle1`)
    const idx = byName.get(`${s}HandIndex1`)
    const pinky = byName.get(`${s}HandPinky1`)
    const hand = byName.get(`${s}Hand`)
    if (!mid || !idx || !pinky || !hand) continue
    const fwd = mid.position.clone().normalize()
    const side = pinky.position.clone().sub(idx.position).normalize()
    const normal = new THREE.Vector3().crossVectors(fwd, side).normalize()
    side.crossVectors(normal, fwd).normalize() // re-orthogonalise
    handFrame.set(s.toLowerCase(), { fwd, normal, side })
  }

  // Per finger bone: flexion (knuckle) axis, expressed in that bone's local
  // frame. Computed geometrically as palmNormal × boneRestDirection so each
  // bone only rotates around its own knuckle → pure flexion, never lateral
  // twist (the cause of distorted fingers). Unlike a single shared hand-side
  // axis, this gives the THUMB its correct, distinct curl axis too. For the
  // four fingers it equals the hand-side axis, preserving the proven sign.
  root.updateWorldMatrix(true, true)
  for (const s of ['Left', 'Right']) {
    const hand = byName.get(`${s}Hand`)
    const hf = handFrame.get(s.toLowerCase())
    if (!hand || !hf) continue
    const hq = hand.getWorldQuaternion(new THREE.Quaternion())
    const normalWorld = hf.normal.clone().applyQuaternion(hq).normalize()
    const sideWorldFallback = hf.side.clone().applyQuaternion(hq).normalize()
    const fwdWorld = hf.fwd.clone().applyQuaternion(hq).normalize()
    const sideWorld = hf.side.clone().applyQuaternion(hq).normalize()
    for (const fg of FINGERS) {
      for (const k of [1, 2, 3]) {
        const info = infos.get(`${s}Hand${fg}${k}`)
        if (!info) continue
        const bwq = info.bone.getWorldQuaternion(new THREE.Quaternion())
        const bwInv = bwq.clone().invert()
        const restWorld = info.axis.clone().applyQuaternion(bwq).normalize()
        const flexWorld = new THREE.Vector3().crossVectors(normalWorld, restWorld)
        if (flexWorld.lengthSq() < 1e-6) flexWorld.copy(sideWorldFallback)
        flexWorld.normalize()
        info.flex = flexWorld.applyQuaternion(bwInv).normalize()
        // Spread (abduction) only at the knuckle (k=1) of the four fingers —
        // the palm-normal axis in bone-local + this finger's rest lateral angle.
        // 벌림 축은 손가락 뿌리 마디(k=1)에만. **엄지도 포함한다** — 엄지가
        // 손바닥을 가로지르는지 옆으로 벌어지는지가 손모양을 가르는 자리인데,
        // 굽힘만으로는 표현되지 않는다.
        if (k === 1) {
          info.abduct = normalWorld.clone().applyQuaternion(bwInv).normalize()
          info.restLat = Math.atan2(restWorld.dot(sideWorld), restWorld.dot(fwdWorld))
        }
      }
    }
  }

  return {
    get: (k) => infos.get(k),
    head: byName.get('Head'),
    hips: byName.get('Hips'),
    faceMeshes,
    handFrame,
  }
}

const _inv = new THREE.Quaternion()
const _tp = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _qc = new THREE.Quaternion()
const _fq = new THREE.Quaternion()
const _dz = new THREE.Vector3()
const _bq = new THREE.Quaternion()
const _sq = new THREE.Quaternion()
// keypoint-derived hand frame (for finger spread), reused per hand
const _kFwd = new THREE.Vector3()
const _kSide = new THREE.Vector3()
const _kNormal = new THREE.Vector3()

/**
 * Build the keypoint hand frame (fwd → middle MCP, side index→pinky, palm
 * normal) from a 3D hand keypoint array into _kFwd/_kSide/_kNormal. Mirrors how
 * the avatar hand frame is built, so lateral angles are directly comparable.
 * Returns false if the needed joints are missing/degenerate.
 */
/** 손바닥 평면(앞·옆·법선)을 키포인트에서 세운다 — 손가락 **벌림**을 재려면 필요하다.
 *
 *  **깊이는 `hand_z`에서 온다.** 예전에는 키포인트의 세 번째 값을 z로 읽었는데,
 *  웹 조각에서 그 자리는 전부 1.0인 자리표시자다. 그래서 손바닥 평면이 늘 화면과
 *  나란해지고, 손이 화면을 향하지 않는 순간 벌림이 엉뚱하게 잡혔다.
 *  게다가 이 함수를 부르는 조건이 `keypoints3d`였는데 웹 조각에는 그 키가 없어
 *  **벌림이 모든 낱말에서 한 번도 켜진 적이 없었다**(2026-08-20 확인). */
function buildKpHandFrame(h: number[], hz: number[] | null): boolean {
  const z = (j: number) => (hz ? hz[j] : 0)
  const wx = h[0], wy = h[1], wz = z(0)
  const mx = h[27], my = h[28], mz = z(9) // middle MCP (joint 9)
  const ix = h[15], iy = h[16], iz = z(5) // index MCP (joint 5)
  const px = h[51], py = h[52], pz = z(17) // pinky MCP (joint 17)
  // 손목은 기준점이라 z가 0인 것이 정상이다 — x·y로만 미검출을 판정한다.
  if ((mx === 0 && my === 0) || (ix === 0 && iy === 0) || (px === 0 && py === 0)) {
    return false
  }
  _kFwd.set(mx - wx, my - wy, mz - wz)
  _kSide.set(px - ix, py - iy, pz - iz)
  if (_kFwd.lengthSq() < 1e-9 || _kSide.lengthSq() < 1e-9) return false
  _kFwd.normalize()
  _kNormal.crossVectors(_kFwd, _kSide)
  if (_kNormal.lengthSq() < 1e-9) return false
  _kNormal.normalize()
  _kSide.crossVectors(_kNormal, _kFwd).normalize()
  return true
}

function aim(
  info: BoneInfo | undefined,
  worldDir: THREE.Vector3 | null,
  parentWorld: THREE.Quaternion,
  out: THREE.Quaternion,
  smooth: number,
  maxAngle: number,
) {
  if (!info) {
    out.copy(parentWorld)
    return
  }
  if (worldDir) {
    _inv.copy(parentWorld).invert()
    _tp.copy(worldDir).applyQuaternion(_inv)
    if (_tp.lengthSq() > 1e-8) {
      _q.setFromUnitVectors(info.axis, _tp.normalize())
      const ang = 2 * Math.acos(Math.min(1, Math.abs(_q.w)))
      if (ang > maxAngle && ang > 1e-4) {
        _qc.identity().slerp(_q, maxAngle / ang)
        _q.copy(_qc)
      }
      if (Number.isFinite(_q.x + _q.y + _q.z + _q.w)) info.smooth.slerp(_q, smooth)
    }
  }
  info.smooth.normalize()
  info.bone.quaternion.copy(info.smooth)
  out.copy(parentWorld).multiply(info.smooth).normalize()
}

const _world = new THREE.Quaternion()
function parentWorldOf(info: BoneInfo): THREE.Quaternion {
  // The arm-chain root's parent (shoulder/spine) is never driven, so its world
  // rotation is constant; read it live from the bone's parent.
  const p = info.bone.parent
  if (p) p.getWorldQuaternion(_world)
  else _world.identity()
  return _world.clone()
}

function aimChain(
  rig: GLBRig,
  keys: string[],
  dirs: (THREE.Vector3 | null)[],
  smooth: number,
  maxAngle: number,
  startParent?: THREE.Quaternion,
): THREE.Quaternion | null {
  const root = rig.get(keys[0])
  if (!root) return null
  let parent = startParent ? startParent.clone() : parentWorldOf(root)
  for (let i = 0; i < keys.length; i++) {
    const info = rig.get(keys[i])
    const out = new THREE.Quaternion()
    aim(info, dirs[i], parent, out, smooth, maxAngle)
    parent = out
  }
  return parent
}

// --- Palm-accurate hand orientation (forward + palm normal) ---
const _mRest = new THREE.Matrix4()
const _mTar = new THREE.Matrix4()
const _f = new THREE.Vector3()
const _s = new THREE.Vector3()
const _nrm = new THREE.Vector3()
const _hinv = new THREE.Quaternion()
const _hq = new THREE.Quaternion()
function aimHand(
  rig: GLBRig,
  side: 'left' | 'right',
  parentWorld: THREE.Quaternion,
  tFwd: THREE.Vector3 | null,
  tSide: THREE.Vector3 | null,
  out: THREE.Quaternion,
) {
  const key = side === 'left' ? 'LeftHand' : 'RightHand'
  const info = rig.get(key)
  const rest = rig.handFrame.get(side)
  if (!info) {
    out.copy(parentWorld)
    return
  }
  if (tFwd && tSide) {
    _nrm.crossVectors(tFwd, tSide)
    if (_nrm.lengthSq() > 1e-6 && rest) {
      _nrm.normalize()
      _s.crossVectors(_nrm, tFwd).normalize()
      _f.copy(tFwd).normalize()
      // to hand's parent-local space
      _hinv.copy(parentWorld).invert()
      _f.applyQuaternion(_hinv)
      _s.applyQuaternion(_hinv)
      _nrm.applyQuaternion(_hinv)
      _mRest.makeBasis(rest.fwd, rest.side, rest.normal)
      _mTar.makeBasis(_f, _s, _nrm)
      _mRest.transpose() // orthonormal → inverse
      _mTar.multiply(_mRest)
      _hq.setFromRotationMatrix(_mTar)
      if (Number.isFinite(_hq.x + _hq.y + _hq.z + _hq.w)) info.smooth.slerp(_hq, SMOOTH_FINGER + 0.06)
    }
  }
  info.smooth.normalize()
  info.bone.quaternion.copy(info.smooth)
  out.copy(parentWorld).multiply(info.smooth).normalize()
}

/** Drive eye-blink via ARKit blendshapes (RPM/Avaturn). amount 0..1. */
/** 입모양(비짐)을 세운다.
 *
 *  아바타(`real-avaturn.glb`)는 Oculus 비짐 15종을 Head·Teeth·Tongue 세 메시에
 *  나눠 갖고 있다 — **셋 다 움직여야** 이가 입술을 뚫고 나오지 않는다.
 *  이름이 없는 메시는 조용히 건너뛴다(아바타를 바꿔도 안 깨진다).
 *
 *  `viseme`이 null이면 전부 0으로 되돌린다 — 마우징이 없는 낱말에서 입이
 *  마지막 모양으로 굳어 있으면 그것대로 이상해 보인다. */
/** 마우징 세기 — 비짐을 1.0으로 주면 **입이 쩍 벌어진다**(2026-08-20 사진 확인).
 *
 *  두 가지가 겹쳐 있었다. ① Oculus 비짐에는 **턱 벌림이 이미 들어 있다** —
 *  거기에 `jawOpen`·`mouthOpen`을 또 더하면 두 번 열린다. ② 수어의 마우징은
 *  소리 내어 말하는 것이 아니라 **입만 조용히 움직이는 것**이라 원래 작다.
 *  크게 벌리면 말하는 것처럼 보여 오히려 어색하다. */
const MOUTH_GAIN = 0.55
/** 턱은 비짐이 못 담는 만큼만 조금 보탠다. `mouthOpen`은 건드리지 않는다. */
const JAW_GAIN = 0.30

export function setMouthGLB(rig: GLBRig, viseme: string | null, weight: number, jaw: number) {
  // **바뀔 때만 쓴다.** 처음에는 프레임마다 모든 얼굴 메시의 비짐 15개와 턱을
  // 다시 써 넣었다. 값이 같아도 three.js는 모프 데이터를 다시 GPU로 올리므로,
  // 머리(72개)·이·혀·눈썹 메시가 매 프레임 갱신되면서 **메인 스레드가 포화됐다**
  // (실측 2026-08-20: 페이지 조회 한 번에 1~2.6초, 단추 클릭이 통째로 실패).
  // 마우징은 초당 몇 번만 바뀌므로 그때만 쓰면 된다.
  const w = viseme ? weight * MOUTH_GAIN : 0
  const j = jaw * JAW_GAIN
  if (viseme === lastViseme && Math.abs(w - lastWeight) < 0.01 && Math.abs(j - lastJaw) < 0.01) return
  const prev = lastViseme
  lastViseme = viseme
  lastWeight = w
  lastJaw = j
  for (const m of rig.faceMeshes) {
    const d = m.morphTargetDictionary
    const inf = m.morphTargetInfluences
    if (!d || !inf) continue
    // 이전에 쓰던 비짐만 0으로 되돌린다 — 15개를 매번 훑지 않는다.
    if (prev && prev !== viseme) {
      const pi = d[prev]
      if (pi !== undefined) inf[pi] = 0
    }
    if (viseme) {
      const i = d[viseme]
      if (i !== undefined) inf[i] = w
    }
    const ji = d['jawOpen']
    if (ji !== undefined) inf[ji] = j
    // `mouthOpen`은 0으로 둔다 — 비짐에 턱 벌림이 이미 들어 있어, 여기까지
    // 열면 입이 쩍 벌어진다(사진으로 확인).
    const mo = d['mouthOpen']
    if (mo !== undefined && inf[mo] !== 0) inf[mo] = 0
  }
}

/** 마지막으로 써 넣은 값 — 같은 값을 다시 쓰지 않기 위해 기억한다. */
let lastViseme: string | null = null
let lastWeight = -1
let lastJaw = -1

/** 아바타를 갈아 끼우면 기억을 지운다(다른 리그에는 다른 비짐이 들어 있다). */
export function resetMouthGLB() {
  lastViseme = null
  lastWeight = -1
  lastJaw = -1
}

export function setBlinkGLB(rig: GLBRig, amount: number) {
  for (const m of rig.faceMeshes) {
    const d = m.morphTargetDictionary
    const inf = m.morphTargetInfluences
    if (!d || !inf) continue
    for (const key of ['eyeBlinkLeft', 'eyeBlinkRight', 'blink', 'eyesClosed']) {
      const i = d[key]
      if (i !== undefined) inf[i] = amount
    }
  }
}

/** Apply a keypoint frame to a GLB humanoid rig. */
/** 마지막 프레임에서 **벌림이 실제로 적용된 손가락 수**.
 *
 *  계측점이다. 벌림은 예전에 `keypoints3d`가 있을 때만 켜지도록 되어 있었는데
 *  웹 조각에는 그 키가 없어 **한 번도 켜진 적이 없었다** — 그런데도 화면은
 *  멀쩡해 보였다(손가락이 굽기는 하니까). 같은 실패를 다시 겪지 않으려고
 *  숫자로 내보낸다. `SignStage`가 `data-sign-spread`로 화면에 붙인다. */
export let lastSpreadCount = 0

export function applyPoseToGLB(rig: GLBRig, data: SignData, frame: number) {
  let spreadUsed = 0
  const f = Math.max(0, Math.min(frame, data.num_frames - 1))
  const use3d = !!data.keypoints3d
  const k = data.keypoints3d ?? data.keypoints
  const pose = use3d ? smooth3d(k.pose, f, scratchPose3) : smoothInto(data.keypoints.pose, f, scratchPose)
  if (!pose) return
  const hr = use3d ? smooth3d(k.hand_right, f, scratchHR3) : data.keypoints.hand_right && (smoothInto(data.keypoints.hand_right, f, scratchHR) ?? undefined)
  const hl = use3d ? smooth3d(k.hand_left, f, scratchHL3) : data.keypoints.hand_left && (smoothInto(data.keypoints.hand_left, f, scratchHL) ?? undefined)

  const poseDir = (a: number, b: number, key: string) =>
    use3d ? segDir3Dreal(pose, a, b) : segDir3D(pose, a, b, restLen(data, data.keypoints.pose, a, b, key))
  /** 손 깊이(z)를 이 프레임만큼 꺼낸다 — **손가락 계산에만** 쓴다.
   *
   *  팔·몸통은 지금까지의 2D 경로를 그대로 둔다. 팔까지 3D로 바꾸면 3D가 없는
   *  조각과 섞일 때 기준이 달라져 팔이 튄다(그래서 원래 3D를 통째로 안 실었다).
   *  손가락은 조각 안에서만 쓰는 값이라 섞여도 튀지 않는다. */
  const handZ = (side: 'hand_left' | 'hand_right'): number[] | null => {
    const rows = data.hand_z?.[side]
    if (!rows || !rows.length) return null
    const idx = Math.min(rows.length - 1, Math.max(0, Math.round(f)))
    const row = rows[idx]
    return row && row.length >= 21 ? row : null
  }

  // 손 크기(손목→중지 MCP)를 재 둔다. 손가락 마디 길이를 이 값에 견줘 판단한다.
  const handScale = (h: number[] | undefined | null): number => {
    if (!h || h.length < 30) return 0
    const dx = h[27] - h[0], dy = h[28] - h[1]
    return Math.hypot(dx, dy)
  }
  /** 방향을 못 믿을 만큼 짧은 마디는 **버린다**(null).
   *
   *  손 키포인트에는 깊이가 없다 — 세 번째 값이 전부 정확히 1.0인 자리표시자다
   *  (2026-08-20에 글로스 파일 8,421값을 세어 확인). 그래서 손가락 방향은 사실상
   *  2D 투영이고, 손가락이 카메라 쪽을 향하면 투영 길이가 1~3픽셀로 줄어든다.
   *  그 상태의 방향은 거의 잡음인데, 그대로 각도로 바꾸면 마디가 엉뚱하게 꺾인다.
   *  짧으면 null을 돌려주고, 호출부는 **직전 자세를 유지**한다(움찔거림 없이 멈춘다). */
  const MIN_SEG_RATIO = 0.13
  const handDir = (h: number[] | undefined | null, a: number, b: number) => {
    if (!h) return null
    const d = use3d ? segDir3Dreal(h, a, b) : segDir(h, a, b, 0.4)
    if (!d) return null
    const sc = handScale(h)
    if (sc > 0) {
      const dx = h[b * 3] - h[a * 3], dy = h[b * 3 + 1] - h[a * 3 + 1]
      if (Math.hypot(dx, dy) < sc * MIN_SEG_RATIO) return null
    }
    return d
  }

  /** 손 키포인트 두 점의 방향 — 깊이(`hand_z`)까지 써서 잰다.
   *  손바닥 평면과 같은 기준이라 벌림 각도가 손 방향에 흔들리지 않는다. */
  const dirWithZ = (h: number[], hz: number[] | null, a: number, b: number) => {
    if (!hz) return null
    const dx = h[b * 3] - h[a * 3]
    const dy = h[b * 3 + 1] - h[a * 3 + 1]
    const dz = hz[b] - hz[a]
    const L = Math.sqrt(dx * dx + dy * dy + dz * dz)
    if (L < 1e-6) return null
    return _dz.set(dx / L, dy / L, dz / L)
  }

  // arms (shoulder→elbow), then palm-accurate hand, then fingers off the hand.
  for (const [Side, side, hand, sh, el, wr] of [
    ['Right', 'right', hr, RSH, REL, RWR],
    ['Left', 'left', hl, LSH, LEL, LWR],
  ] as const) {
    const foreWorld = aimChain(rig, [`${Side}Arm`, `${Side}ForeArm`],
      [poseDir(sh, el, `${Side}U`), poseDir(el, wr, `${Side}L`)], SMOOTH, ARM_MAX)
    if (!foreWorld) continue
    const h = hand as number[] | undefined
    const handWorld = new THREE.Quaternion()
    aimHand(rig, side, foreWorld, h ? handDir(h, 0, 9) : null, h ? handDir(h, 5, 17) : null, handWorld)
    if (!h) continue
    // 손바닥 평면을 세워 손가락 **벌림**까지 잰다. 깊이(`hand_z`)가 있어야
    // 평면이 제대로 서므로, 깊이가 없는 조각에서는 굽힘만 쓴다.
    const hzFrame = handZ(side === 'right' ? 'hand_right' : 'hand_left')
    const spreadOK = !!hzFrame && buildKpHandFrame(h, hzFrame)
    // ── 손가락: **손가락당 굽힘 하나**를 재고, 마디에 해부학 비율로 나눠 준다.
    //
    //  왜 마디별로 재지 않나. 손 키포인트에는 **깊이가 없다** — 세 번째 값이 전부
    //  1.0인 자리표시자다(2026-08-20 확인). 그래서 마디 방향은 2D 투영뿐인데,
    //  손가락이 카메라 쪽으로 굽으면 투영이 짧아져 **굽었는데 곧게 보인다.**
    //  마디마다 각도를 뽑으면 그 오차가 세 번 곱해져 손이 뒤틀린다.
    //
    //  대신 **줄자 비율**을 쓴다. 손가락을 따라간 길이(마디 합)와 뿌리→끝 직선
    //  거리의 비다.
    //
    //      곧게 편 손가락   직선 ≈ 마디 합        → 비율 ≈ 1
    //      완전히 쥔 손가락 직선 ≪ 마디 합        → 비율 ≈ 0.3
    //
    //  이 비율은 **투영에 강하다** — 손가락이 카메라를 향하면 분자와 분모가 함께
    //  줄어들어 비율이 거의 그대로다. 깊이가 없어도 굽힘 정도는 살아남는다.
    //
    //  나눠 주는 비율(MCP:PIP:DIP)은 사람 손의 실제 움직임을 따른다. 마디별
    //  측정이 믿을 만할 때(마디가 충분히 길 때)는 그 비로 나누고, 아니면
    //  해부학 기본비로 나눈다. 어느 쪽이든 **사람 손에서 나올 수 있는 자세만**
    //  만들어진다 — 손이 꺾이거나 뒤틀리는 자세는 원리상 나오지 않는다.
    const px = (i: number) => h[i * 3]
    const py = (i: number) => h[i * 3 + 1]
    // 깊이가 있으면 **3D 거리**로 잰다. 손가락이 카메라를 향해 굽어도 길이가
    // 제대로 줄어들어, 2D만 볼 때의 "굽었는데 곧게" 문제가 사라진다.
    // 실측: z를 쓰면 뼈 길이 변동계수 0.159 → 0.121 (24% 개선).
    const hz = handZ(side === 'right' ? 'hand_right' : 'hand_left')
    const dist2 = (i: number, j: number) => {
      const dx = px(j) - px(i)
      const dy = py(j) - py(i)
      if (!hz) return Math.hypot(dx, dy)
      const az = hz[i]
      const bz = hz[j]
      // 미검출(0)이면 그 점은 깊이를 모르는 것 — 2D로 잰다.
      if (az === 0 && bz === 0) return Math.hypot(dx, dy)
      return Math.sqrt(dx * dx + dy * dy + (bz - az) * (bz - az))
    }

    for (const fg of FINGERS) {
      const segs = HAND_SEGS[fg]
      const root = segs[0][0]
      const tip = segs[2][1]
      // 마디 합과 직선 거리. 하나라도 0점(미검출)이면 이 손가락은 건드리지 않는다.
      let chain = 0
      let bad = false
      for (const [a, b] of segs) {
        if ((px(a) === 0 && py(a) === 0) || (px(b) === 0 && py(b) === 0)) { bad = true; break }
        chain += dist2(a, b)
      }
      if (bad || chain <= 1e-3) continue
      const ratio = dist2(root, tip) / chain
      const curl = curlOf(ratio)

      // 마디별 측정이 믿을 만하면 그 비로 나눈다(손모양을 더 살린다).
      const raw: number[] = []
      let prev = handDir(h, 0, root)
      let usable = 0
      for (let k = 0; k < 3; k++) {
        const [a, b] = segs[k]
        const cur = handDir(h, a, b)
        if (cur && prev) {
          raw.push(Math.acos(Math.max(-1, Math.min(1, prev.dot(cur)))))
          usable += 1
        } else raw.push(-1)
        if (cur) prev = cur
      }
      const rawSum = raw.reduce((t, v) => t + (v > 0 ? v : 0), 0)
      const share = FLEX_SHARE[fg]
      const useRaw = usable >= 2 && rawSum > 0.15

      for (let k = 0; k < 3; k++) {
        const info = rig.get(`${Side}Hand${fg}${k + 1}`)
        if (!info || !info.flex) continue
        // 이 마디가 받을 몫 — 측정이 믿을 만하면 측정 비, 아니면 해부학 비.
        const w = useRaw && raw[k] > 0
          ? raw[k] / rawSum
          : share[k] / (share[0] + share[1] + share[2])
        const ang = Math.min(FINGER_FLEX_MAX, curl * (share[0] + share[1] + share[2]) * w)
        _fq.setFromAxisAngle(info.flex, -ang) // 손바닥 쪽으로만 굽는다

        let spread = 0
        if (spreadOK && k === 0 && info.abduct && info.restLat != null) {
          // 벌림은 **손바닥 평면 안의 각도**다. 손바닥 평면을 hand_z로 세웠으므로
          // 손가락 방향도 같은 깊이로 재야 한다 — 2D 방향을 3D 기준에 대면
          // 손이 화면을 향하지 않는 순간 각도가 어긋난다.
          const cur0 = dirWithZ(h, hzFrame, segs[0][0], segs[0][1]) ?? handDir(h, segs[0][0], segs[0][1])
          if (cur0) {
            const curLat = Math.atan2(cur0.dot(_kSide), cur0.dot(_kFwd))
            const cap = fg === 'Thumb' ? THUMB_SPREAD_MAX : FINGER_SPREAD_MAX
            // 잰 값을 그대로 쓰지 않고 **줄여서** 쓴다. 실측한 떨림(2차차분 5~11°)과
            // 낱말 사이 차이(12~29°)로 계산한 신호 비중이 0.87~0.91이었다.
            const raw0 = (curLat - info.restLat) * SPREAD_TRUST
            spread = Math.max(-cap, Math.min(cap, raw0))
            if (spread !== 0) spreadUsed += 1
          }
        }
        if (spread !== 0 && info.abduct) {
          _sq.setFromAxisAngle(info.abduct, spread)
          _bq.copy(info.bind).multiply(_sq).multiply(_fq)
        } else {
          _bq.copy(info.bind).multiply(_fq)
        }
        if (Number.isFinite(_bq.x + _bq.y + _bq.z + _bq.w)) info.smooth.slerp(_bq, SMOOTH_FINGER)
        info.bone.quaternion.copy(info.smooth)
      }
    }
  }
  // Mouth/expression intentionally not driven from data — keypoint-derived
  // mouth looked unnatural; only the periodic eye-blink (in Avatar3D) remains.
  lastSpreadCount = spreadUsed
}

const scratchPose: number[] = []
const scratchHR: number[] = []
const scratchHL: number[] = []
const scratchPose3: number[] = []
const scratchHR3: number[] = []
const scratchHL3: number[] = []

/**
 * Temporal smoothing for TRUE 3D landmarks (x,y,z triplets, no confidence):
 * weighted ±2-frame average per joint (current frame dominant, so hand-shapes
 * stay crisp), skipping missing (0,0,0) joints so they don't drag a valid joint
 * toward the origin. The wider window reduces frame-to-frame jitter for more
 * fluid, natural-looking motion.
 */
function smooth3d(frames: number[][] | undefined, f: number, buf: number[]): number[] | undefined {
  if (!frames) return undefined
  const cur = frames[f]
  if (!cur) return undefined
  const a = frames[f - 1]
  const b = frames[f + 1]
  const a2 = frames[f - 2]
  const b2 = frames[f + 2]
  const n = cur.length
  buf.length = n
  for (let j = 0; j < n; j += 3) {
    let x = 0, y = 0, z = 0, w = 0
    const valid = (fr: number[] | undefined, wt: number) => {
      if (!fr) return
      if (fr[j] === 0 && fr[j + 1] === 0 && fr[j + 2] === 0) return
      x += fr[j] * wt; y += fr[j + 1] * wt; z += fr[j + 2] * wt; w += wt
    }
    valid(cur, 0.5)
    valid(a, 0.24)
    valid(b, 0.24)
    valid(a2, 0.1)
    valid(b2, 0.1)
    if (w > 0) { buf[j] = x / w; buf[j + 1] = y / w; buf[j + 2] = z / w } else { buf[j] = 0; buf[j + 1] = 0; buf[j + 2] = 0 }
  }
  return buf
}

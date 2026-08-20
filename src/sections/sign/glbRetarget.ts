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

const RSH = 2, REL = 3, RWR = 4
const LSH = 5, LEL = 6, LWR = 7
// Higher = tighter tracking of the actual sign (less lag), lower = smoother.
// Tuned up from 0.4/0.16 so hand-shapes reach the keypoint pose more faithfully.
const SMOOTH = 0.46, SMOOTH_FINGER = 0.26
const ARM_MAX = 2.7

// Map our logical bone keys → RPM/Mixamo bone-name suffix.
const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']
const HAND_SEGS: Record<string, [number, number][]> = {
  Thumb: [[1, 2], [2, 3], [3, 4]],
  Index: [[5, 6], [6, 7], [7, 8]],
  Middle: [[9, 10], [10, 11], [11, 12]],
  Ring: [[13, 14], [14, 15], [15, 16]],
  Pinky: [[17, 18], [18, 19], [19, 20]],
}

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
const FINGER_SPREAD_MAX = 0.42 // cap MCP lateral spread (~24°)

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
        if (k === 1 && fg !== 'Thumb') {
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
function buildKpHandFrame(h: number[]): boolean {
  const wx = h[0], wy = h[1], wz = h[2]
  const mx = h[27], my = h[28], mz = h[29] // middle MCP (joint 9)
  const ix = h[15], iy = h[16], iz = h[17] // index MCP (joint 5)
  const px = h[51], py = h[52], pz = h[53] // pinky MCP (joint 17)
  if ((mx === 0 && my === 0 && mz === 0) || (ix === 0 && iy === 0 && iz === 0) || (px === 0 && py === 0 && pz === 0)) {
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
export function applyPoseToGLB(rig: GLBRig, data: SignData, frame: number) {
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
    // Build a keypoint-derived hand frame (3D only) so we can measure each
    // finger's lateral SPREAD, not just its curl.
    const spreadOK = use3d && buildKpHandFrame(h)
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
    const FLEX_SHARE: Record<string, number[]> = {
      // 마디별 최대 굽힘(라디안). 엄지는 다른 손가락보다 덜 굽는다.
      Thumb: [0.62, 0.95, 0.55],
      Index: [1.30, 1.45, 0.85],
      Middle: [1.32, 1.48, 0.88],
      Ring: [1.30, 1.45, 0.85],
      Pinky: [1.22, 1.40, 0.82],
    }
    /** 비율 → 굽힘(0~1). 1.0이면 곧게, 0.35 이하면 완전히 쥔 것으로 본다. */
    const curlOf = (ratio: number) => {
      const c = (1 - ratio) / 0.65
      return c < 0 ? 0 : c > 1 ? 1 : c
    }
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
        if (spreadOK && k === 0 && fg !== 'Thumb' && info.abduct && info.restLat != null) {
          const cur0 = handDir(h, segs[0][0], segs[0][1])
          if (cur0) {
            const curLat = Math.atan2(cur0.dot(_kSide), cur0.dot(_kFwd))
            spread = Math.max(-FINGER_SPREAD_MAX, Math.min(FINGER_SPREAD_MAX, curLat - info.restLat))
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

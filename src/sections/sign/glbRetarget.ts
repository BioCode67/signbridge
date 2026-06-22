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
const SMOOTH = 0.4, SMOOTH_FINGER = 0.16
const ARM_MAX = 2.7, FINGER_MAX = 1.5

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
}

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

/** Apply a keypoint frame to a GLB humanoid rig. */
export function applyPoseToGLB(rig: GLBRig, data: SignData, frame: number) {
  const f = Math.max(0, Math.min(frame, data.num_frames - 1))
  const use3d = !!data.keypoints3d
  const k = data.keypoints3d ?? data.keypoints
  const pose = use3d ? k.pose[f] : smoothInto(data.keypoints.pose, f, scratchPose)
  if (!pose) return
  const hr = use3d ? k.hand_right?.[f] : data.keypoints.hand_right && (smoothInto(data.keypoints.hand_right, f, scratchHR) ?? undefined)
  const hl = use3d ? k.hand_left?.[f] : data.keypoints.hand_left && (smoothInto(data.keypoints.hand_left, f, scratchHL) ?? undefined)

  const poseDir = (a: number, b: number, key: string) =>
    use3d ? segDir3Dreal(pose, a, b) : segDir3D(pose, a, b, restLen(data, data.keypoints.pose, a, b, key))
  const handDir = (h: number[] | undefined | null, a: number, b: number) =>
    !h ? null : use3d ? segDir3Dreal(h, a, b) : segDir(h, a, b, 0.4)

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
    // Knuckle axis in world: fingers should only FLEX in the plane ⟂ to it.
    const hf = rig.handFrame.get(side)
    const sideW = hf ? hf.side.clone().applyQuaternion(handWorld).normalize() : null
    for (const fg of FINGERS) {
      const segs = HAND_SEGS[fg]
      const dirs = segs.map(([a, b]) => {
        const d = handDir(h, a, b)
        if (d && sideW && fg !== 'Thumb') {
          // remove sideways component → natural in-plane curl, no lateral snapping
          d.addScaledVector(sideW, -d.dot(sideW))
          if (d.lengthSq() < 1e-6) return null
          d.normalize()
        }
        return d
      })
      aimChain(rig, [`${Side}Hand${fg}1`, `${Side}Hand${fg}2`, `${Side}Hand${fg}3`],
        dirs, SMOOTH_FINGER, FINGER_MAX, handWorld)
    }
  }

  // mouth (ARKit blendshape) from expr
  const e = data.expr?.[f]
  if (e) {
    const mouth = Math.max(0, Math.min(1, (e.mo - 5) / 23))
    for (const m of rig.faceMeshes) {
      const d = m.morphTargetDictionary!
      const inf = m.morphTargetInfluences!
      const idx = d['mouthOpen'] ?? d['jawOpen'] ?? d['viseme_aa']
      if (idx !== undefined) inf[idx] = mouth
    }
  }
}

const scratchPose: number[] = []
const scratchHR: number[] = []
const scratchHL: number[] = []

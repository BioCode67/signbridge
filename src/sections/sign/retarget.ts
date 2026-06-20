/**
 * Keypoint → VRM bone retargeting.
 *
 * The AI Hub keypoints are 2D only (OpenPose image coords: x→right, y→down,
 * confidence). We assume the signer faces the camera and map each limb/finger
 * segment onto the avatar's camera-facing (XY) plane, then solve each bone's
 * rotation so its rest direction aligns with the segment direction.
 *
 * Math: a bone points along a constant local `axis` at rest. With parent world
 * rotation Qp, to make it point along world dir `t`:
 *     Qlocal = quatFromUnitVectors(axis, Qp⁻¹ · t)
 * We walk each chain root→tip, composing world rotations as we go. The VRM
 * normalized rig aligns every bone's rest axes to world, so the arm and finger
 * rest direction is simply ±X (right arm/fingers −X, left +X) in the T-pose.
 *
 * STEP 2: upper body (shoulder–elbow–wrist) + hand + fingers.
 */
import * as THREE from 'three'
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm'
import type { SignData } from './signTypes'

// ---- OpenPose BODY_25 indices ----
const RSH = 2, REL = 3, RWR = 4
const LSH = 5, LEL = 6, LWR = 7

const CONF_MIN = 0.15
const SMOOTH = 0.45 // slerp factor toward the target each frame (0..1)

const AXIS_R = new THREE.Vector3(-1, 0, 0)
const AXIS_L = new THREE.Vector3(1, 0, 0)
const AXIS_UP = new THREE.Vector3(0, 1, 0) // head/neck rest points +Y

// Scratch (avoid per-frame allocation).
const _dir = new THREE.Vector3()
const _tp = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _inv = new THREE.Quaternion()
const _identity = new THREE.Quaternion()

// Reusable buffers for temporal keypoint smoothing (single avatar on screen).
const _bufPose: number[] = []
const _bufHR: number[] = []
const _bufHL: number[] = []

/**
 * Confidence-weighted temporal average of frame f with its neighbours
 * (0.25 / 0.5 / 0.25). Low-confidence neighbours are dropped, so smoothing
 * never pulls a joint toward a garbage coordinate. Reduces keypoint jitter
 * (especially fingers) at the source. Returns `buf` filled in place, or null.
 */
function smoothInto(frames: number[][], f: number, buf: number[]): number[] | null {
  const cur = frames[f]
  if (!cur) return null
  const prev = frames[f - 1]
  const next = frames[f + 1]
  const n = cur.length
  buf.length = n
  for (let i = 0; i < n; i += 3) {
    const cc = cur[i + 2]
    let xs = 0, ys = 0, wsum = 0
    if (cc >= CONF_MIN) { xs += cur[i] * 0.5; ys += cur[i + 1] * 0.5; wsum += 0.5 }
    if (prev && prev[i + 2] >= CONF_MIN) { xs += prev[i] * 0.25; ys += prev[i + 1] * 0.25; wsum += 0.25 }
    if (next && next[i + 2] >= CONF_MIN) { xs += next[i] * 0.25; ys += next[i + 1] * 0.25; wsum += 0.25 }
    if (wsum > 0) { buf[i] = xs / wsum; buf[i + 1] = ys / wsum } else { buf[i] = cur[i]; buf[i + 1] = cur[i + 1] }
    buf[i + 2] = cc
  }
  return buf
}

const stateOf = new WeakMap<VRM, Map<string, THREE.Quaternion>>()
function smoothMap(vrm: VRM): Map<string, THREE.Quaternion> {
  let m = stateOf.get(vrm)
  if (!m) {
    m = new Map()
    stateOf.set(vrm, m)
  }
  return m
}

// Per-sentence true (in-plane) segment lengths, used to recover depth from
// foreshortening. Cached per SignData.
const lenCache = new WeakMap<SignData, Map<string, number>>()
function restLen(data: SignData, frames: number[][], a: number, b: number, key: string): number {
  let m = lenCache.get(data)
  if (!m) {
    m = new Map()
    lenCache.set(data, m)
  }
  const hit = m.get(key)
  if (hit !== undefined) return hit
  // True length ≈ the longest high-confidence 2D length seen (limb in-plane).
  let max = 0
  for (let f = 0; f < frames.length; f++) {
    const fr = frames[f]
    if (!fr || fr[a * 3 + 2] < CONF_MIN || fr[b * 3 + 2] < CONF_MIN) continue
    const l = Math.hypot(fr[b * 3] - fr[a * 3], fr[b * 3 + 1] - fr[a * 3 + 1])
    if (l > max) max = l
  }
  m.set(key, max)
  return max
}

/**
 * Direction of segment a→b with depth recovered from foreshortening.
 * If the 2D length is shorter than the true length `rest`, the missing length
 * becomes a +z component (toward the camera) — signers gesture forward, so the
 * sign is always positive. Falls back to the flat plane when `rest` is unknown.
 */
function segDir3D(kp: number[], a: number, b: number, rest: number): THREE.Vector3 | null {
  const n = kp.length / 3
  if (a >= n || b >= n || kp[a * 3 + 2] < CONF_MIN || kp[b * 3 + 2] < CONF_MIN) return null
  const dx = kp[b * 3] - kp[a * 3]
  const dy = kp[b * 3 + 1] - kp[a * 3 + 1]
  const l2 = dx * dx + dy * dy
  if (l2 < 1e-6) return null
  const z = rest > 0 && l2 < rest * rest ? Math.sqrt(rest * rest - l2) : 0
  _dir.set(dx, -dy, z)
  return _dir.normalize().clone()
}

/** Direction of segment a→b in the given keypoint array, mapped to avatar XY (z=0). Null if low conf. */
function segDir(kp: number[], a: number, b: number): THREE.Vector3 | null {
  const n = kp.length / 3
  if (a >= n || b >= n) return null
  if (kp[a * 3 + 2] < CONF_MIN || kp[b * 3 + 2] < CONF_MIN) return null
  const dx = kp[b * 3] - kp[a * 3]
  const dy = kp[b * 3 + 1] - kp[a * 3 + 1]
  _dir.set(dx, -dy, 0)
  if (_dir.lengthSq() < 1e-6) return null
  return _dir.normalize().clone()
}

/**
 * Aim a bone so it points along `worldDir`, given its parent's world quaternion.
 * Smooths toward the target and writes the bone's resulting world quat into `out`.
 */
function aimBone(
  vrm: VRM,
  name: VRMHumanBoneName,
  axis: THREE.Vector3,
  worldDir: THREE.Vector3 | null,
  parentWorld: THREE.Quaternion,
  out: THREE.Quaternion,
) {
  const node = vrm.humanoid.getNormalizedBoneNode(name)
  if (!node) {
    out.copy(parentWorld)
    return
  }
  const m = smoothMap(vrm)
  let local = m.get(name)
  if (!local) {
    local = new THREE.Quaternion()
    m.set(name, local)
  }
  if (worldDir) {
    // targetInParent = parentWorld⁻¹ · worldDir
    _inv.copy(parentWorld).invert()
    _tp.copy(worldDir).applyQuaternion(_inv)
    if (_tp.lengthSq() > 1e-8) {
      _q.setFromUnitVectors(axis, _tp.normalize())
      if (Number.isFinite(_q.x + _q.y + _q.z + _q.w)) {
        local.slerp(_q, SMOOTH) // smooth toward target; low-conf frames just hold `local`
      }
    }
  }
  local.normalize()
  node.quaternion.copy(local)
  out.copy(parentWorld).multiply(local).normalize()
}

/** Drive one arm (upper + lower), returning the hand's world quaternion for finger chaining. */
function aimArm(
  vrm: VRM,
  data: SignData,
  pose: number[],
  hand: number[] | undefined,
  axis: THREE.Vector3,
  side: 'left' | 'right',
  sh: number,
  el: number,
  wr: number,
  outHandWorld: THREE.Quaternion,
) {
  const worldU = new THREE.Quaternion()
  const worldL = new THREE.Quaternion()
  const frames = data.keypoints.pose
  const restU = restLen(data, frames, sh, el, `${side}U`)
  const restL = restLen(data, frames, el, wr, `${side}L`)
  aimBone(vrm, `${side}UpperArm` as VRMHumanBoneName, axis, segDir3D(pose, sh, el, restU), _identity, worldU)
  aimBone(vrm, `${side}LowerArm` as VRMHumanBoneName, axis, segDir3D(pose, el, wr, restL), worldU, worldL)
  // Hand orientation from wrist(0)→middle-MCP(9) of the hand keypoints.
  const handDir = hand ? segDir(hand, 0, 9) : null
  aimBone(vrm, `${side}Hand` as VRMHumanBoneName, axis, handDir, worldL, outHandWorld)
}

// Finger bone suffixes + their OpenPose hand-keypoint segments (root→tip).
const FINGERS: { bones: string[]; segs: [number, number][] }[] = [
  { bones: ['ThumbMetacarpal', 'ThumbProximal', 'ThumbDistal'], segs: [[1, 2], [2, 3], [3, 4]] },
  { bones: ['IndexProximal', 'IndexIntermediate', 'IndexDistal'], segs: [[5, 6], [6, 7], [7, 8]] },
  { bones: ['MiddleProximal', 'MiddleIntermediate', 'MiddleDistal'], segs: [[9, 10], [10, 11], [11, 12]] },
  { bones: ['RingProximal', 'RingIntermediate', 'RingDistal'], segs: [[13, 14], [14, 15], [15, 16]] },
  { bones: ['LittleProximal', 'LittleIntermediate', 'LittleDistal'], segs: [[17, 18], [18, 19], [19, 20]] },
]

function aimFingers(
  vrm: VRM,
  hand: number[] | undefined,
  axis: THREE.Vector3,
  side: 'left' | 'right',
  handWorld: THREE.Quaternion,
) {
  if (!hand) return
  for (const finger of FINGERS) {
    let parentWorld = handWorld
    const carry = new THREE.Quaternion()
    for (let i = 0; i < finger.bones.length; i++) {
      const name = `${side}${finger.bones[i]}` as VRMHumanBoneName
      const [a, b] = finger.segs[i]
      const world = new THREE.Quaternion()
      aimBone(vrm, name, axis, segDir(hand, a, b), parentWorld, world)
      carry.copy(world)
      parentWorld = carry
    }
  }
}

/** Arms lowered from the T-pose into a relaxed rest pose (idle / no data). */
const _euler = new THREE.Euler()
function setBone(vrm: VRM, name: VRMHumanBoneName, x: number, y: number, z: number) {
  const b = vrm.humanoid.getNormalizedBoneNode(name)
  if (b) b.quaternion.setFromEuler(_euler.set(x, y, z))
}
export function restPoseVRM(vrm: VRM) {
  setBone(vrm, 'leftUpperArm', 0, 0, -1.2)
  setBone(vrm, 'rightUpperArm', 0, 0, 1.2)
  setBone(vrm, 'leftLowerArm', 0, -0.2, -0.2)
  setBone(vrm, 'rightLowerArm', 0, 0.2, 0.2)
}

/** Drive mouth + brows from the non-manual expression data. */
function applyExpression(vrm: VRM, data: SignData, f: number) {
  const em = vrm.expressionManager
  if (!em) return
  const e = data.expr?.[f]
  const mouth = e ? Math.max(0, Math.min(1, (e.mo - 5) / 23)) : 0
  const brow = e ? Math.max(0, Math.min(1, (e.br - 8) / 14)) : 0
  em.setValue('aa', mouth) // mouth opening
  em.setValue('surprised', brow * 0.4) // raised brows ≈ mild surprise
}

/** Retarget a frame of keypoints onto the VRM (upper body + fingers + face). */
export function applyPoseToVRM(vrm: VRM, data: SignData, frame: number) {
  const f = Math.max(0, Math.min(frame, data.num_frames - 1))
  const pose = smoothInto(data.keypoints.pose, f, _bufPose)
  if (!pose) return
  const hr = data.keypoints.hand_right ? smoothInto(data.keypoints.hand_right, f, _bufHR) ?? undefined : undefined
  const hl = data.keypoints.hand_left ? smoothInto(data.keypoints.hand_left, f, _bufHL) ?? undefined : undefined

  const handWorldR = new THREE.Quaternion()
  const handWorldL = new THREE.Quaternion()
  aimArm(vrm, data, pose, hr, AXIS_R, 'right', RSH, REL, RWR, handWorldR)
  aimArm(vrm, data, pose, hl, AXIS_L, 'left', LSH, LEL, LWR, handWorldL)
  aimFingers(vrm, hr, AXIS_R, 'right', handWorldR)
  aimFingers(vrm, hl, AXIS_L, 'left', handWorldL)

  // Subtle head tilt from neck→nose, plus facial expression.
  const headWorld = new THREE.Quaternion()
  aimBone(vrm, 'neck', AXIS_UP, segDir(pose, 1, 0), _identity, headWorld)
  applyExpression(vrm, data, f)
}

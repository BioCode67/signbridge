/**
 * Keypoint → VRM bone retargeting.
 *
 * The AI Hub keypoints are 2D only (OpenPose image coords: x→right, y→down,
 * confidence). We assume the signer faces the camera and map each limb segment
 * onto the avatar's camera-facing (XY) plane, then solve each bone's rotation so
 * its rest direction aligns with the segment direction.
 *
 * Math: a bone points along a constant local `axis` at rest. With parent world
 * rotation Qp, to make it point along world dir `t`:
 *     Qlocal = quatFromUnitVectors(axis, Qp⁻¹ · t)
 * We walk each chain root→tip, composing world rotations as we go.
 *
 * STEP 2a: upper body (shoulder–elbow–wrist). Fingers/head come next.
 */
import * as THREE from 'three'
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm'
import type { SignData } from './signTypes'

// ---- OpenPose BODY_25 indices we use ----
const RSH = 2, REL = 3, RWR = 4
const LSH = 5, LEL = 6, LWR = 7

const CONF_MIN = 0.15
const SMOOTH = 0.45 // slerp factor toward the target each frame (0..1)

// Rest directions (world space, T-pose, model facing +Z): right arm points -X,
// left arm +X. Forearms continue along the same axis at rest.
const AXIS_R = new THREE.Vector3(-1, 0, 0)
const AXIS_L = new THREE.Vector3(1, 0, 0)

// Scratch objects (avoid per-frame allocation).
const _t = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _inv = new THREE.Quaternion()

interface SmoothState {
  q: Map<VRMHumanBoneName, THREE.Quaternion>
}
const stateOf = new WeakMap<VRM, SmoothState>()
function getState(vrm: VRM): SmoothState {
  let s = stateOf.get(vrm)
  if (!s) {
    s = { q: new Map() }
    stateOf.set(vrm, s)
  }
  return s
}

/** Direction of segment a→b, mapped to the avatar's XY plane (z=0). Null if low confidence. */
function segDir(pose: number[], a: number, b: number): THREE.Vector3 | null {
  const ca = pose[a * 3 + 2]
  const cb = pose[b * 3 + 2]
  if (ca < CONF_MIN || cb < CONF_MIN) return null
  const dx = pose[b * 3] - pose[a * 3]
  const dy = pose[b * 3 + 1] - pose[a * 3 + 1]
  // image x→ +X, image y(down)→ -Y, depth unknown → 0
  const v = _t.set(dx, -dy, 0)
  if (v.lengthSq() < 1e-6) return null
  return v.normalize().clone()
}

/** Set a bone's local quaternion (smoothed) so it aims along `worldDir`, given its parent's world quat. */
function aimBone(
  vrm: VRM,
  name: VRMHumanBoneName,
  axis: THREE.Vector3,
  worldDir: THREE.Vector3 | null,
  parentWorld: THREE.Quaternion,
  out: THREE.Quaternion, // receives this bone's resulting world quaternion
) {
  const node = vrm.humanoid.getNormalizedBoneNode(name)
  const st = getState(vrm)
  if (!node) {
    out.copy(parentWorld)
    return
  }
  let target: THREE.Quaternion
  if (worldDir) {
    // targetInParent = parentWorld⁻¹ · worldDir
    _inv.copy(parentWorld).invert()
    const tp = _t.copy(worldDir).applyQuaternion(_inv)
    target = _q.setFromUnitVectors(axis, tp).clone()
  } else {
    // Low confidence → keep last local rotation.
    target = (st.q.get(name) ?? new THREE.Quaternion()).clone()
  }
  const prev = st.q.get(name)
  if (prev) prev.slerp(target, SMOOTH)
  else st.q.set(name, target.clone())
  const local = st.q.get(name)!
  if (prev) st.q.set(name, prev)
  node.quaternion.copy(local)
  // world = parentWorld · local
  out.copy(parentWorld).multiply(local)
}

/** Drive one arm (upper + lower) from shoulder/elbow/wrist keypoints. */
function aimArm(
  vrm: VRM,
  pose: number[],
  axis: THREE.Vector3,
  upper: VRMHumanBoneName,
  lower: VRMHumanBoneName,
  sh: number,
  el: number,
  wr: number,
) {
  const worldU = new THREE.Quaternion()
  const worldL = new THREE.Quaternion()
  const identity = new THREE.Quaternion()
  aimBone(vrm, upper, axis, segDir(pose, sh, el), identity, worldU)
  aimBone(vrm, lower, axis, segDir(pose, el, wr), worldU, worldL)
}

/** Arms lowered from the T-pose into a relaxed rest pose. */
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

/** Retarget a frame of keypoints onto the VRM (upper body). */
export function applyPoseToVRM(vrm: VRM, data: SignData, frame: number) {
  const f = Math.max(0, Math.min(frame, data.num_frames - 1))
  const pose = data.keypoints.pose[f]
  if (!pose) return
  aimArm(vrm, pose, AXIS_R, 'rightUpperArm', 'rightLowerArm', RSH, REL, RWR)
  aimArm(vrm, pose, AXIS_L, 'leftUpperArm', 'leftLowerArm', LSH, LEL, LWR)
}

/**
 * Keypoint → VRM bone retargeting.
 *
 * STEP 1 (current): placeholder — holds a natural rest pose so we can confirm
 * the model loads and renders. STEP 2 will map AI Hub OpenPose keypoints
 * (pose 25 + hands 21×2, 2D) onto bone rotations.
 */
import * as THREE from 'three'
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm'
import type { SignData } from './signTypes'

const _euler = new THREE.Euler()

function setBone(vrm: VRM, name: VRMHumanBoneName, x: number, y: number, z: number) {
  const b = vrm.humanoid.getNormalizedBoneNode(name)
  if (b) b.quaternion.setFromEuler(_euler.set(x, y, z))
}

/** Arms lowered from the T-pose into a relaxed rest pose. */
export function restPoseVRM(vrm: VRM) {
  setBone(vrm, 'leftUpperArm', 0, 0, -1.2)
  setBone(vrm, 'rightUpperArm', 0, 0, 1.2)
  setBone(vrm, 'leftLowerArm', 0, -0.2, -0.2)
  setBone(vrm, 'rightLowerArm', 0, 0.2, 0.2)
}

/**
 * STEP 1 placeholder: rest pose regardless of frame.
 * (Replaced by real keypoint retargeting in STEP 2.)
 */
export function applyPoseToVRM(vrm: VRM, _data: SignData, _frame: number) {
  restPoseVRM(vrm)
}

/** One sign-language word (gloss) with its timing in seconds. */
export interface Gloss {
  gloss: string
  start: number
  end: number
}

/** Per-frame non-manual expression: mouth opening (mo), brow height (br). */
export interface Expr {
  mo: number
  br: number
}

/**
 * A single disaster sentence + its captured Korean Sign Language motion.
 *
 * Keypoints are OpenPose-format **flat** arrays per frame:
 *   pose      → 25 joints × [x, y, confidence] = 75 numbers
 *   hand_left → 21 joints × [x, y, confidence] = 63 numbers
 *   hand_right→ 21 joints × [x, y, confidence] = 63 numbers
 * Coordinates are in source pixels (≈650–1350 x, 200–1100 y).
 */
export interface SignData {
  korean_text: string
  fps: number
  num_frames: number
  gloss_sequence: Gloss[]
  keypoints: {
    pose: number[][]
    hand_left: number[][]
    hand_right: number[][]
  }
  /**
   * True 3D landmarks in camera space (mm), present when the source clip had
   * them. Used by the 3D avatar for accurate depth instead of guessing from 2D.
   * Same joint layout as `keypoints`, but [x, y, z] (no confidence).
   */
  keypoints3d?: {
    pose: number[][]
    hand_left: number[][]
    hand_right: number[][]
  }
  expr?: Expr[]
}

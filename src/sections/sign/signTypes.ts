/** One sign-language word (gloss) with its timing in seconds. */
export interface Gloss {
  gloss: string
  start: number
  end: number
  /** 이 낱말에 함께 나오는 고개 동작 — 부정은 젓고, 당부는 끄덕인다.
   *  원본 비수지 주석에서 재고(`ml/etl/aihub_nms.py`) 사람이 확정한 낱말에만 붙는다. */
  head?: 'nod' | 'shake'
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
  /**
   * 손의 **깊이(z)만** — 손목을 0으로 잡은 상대값이다.
   *
   * 손가락 굽힘을 2D 투영만으로 재면 손가락이 카메라를 향할 때 "굽었는데 곧게"
   * 보인다. 원본에는 손 깊이가 있는데 그동안 웹으로 안 실었다(2026-08-20 확인).
   * 실측: z를 함께 쓰면 뼈 길이가 24% 더 일정해진다(변동계수 0.159→0.121).
   *
   * x·y는 `keypoints`와 완전히 같아서(24만 점 전수 확인) 다시 싣지 않는다.
   * 프레임마다 점 21개. 미검출 점은 0. 3D가 없던 조각에는 이 값이 없고,
   * 그때는 지금까지처럼 2D로 굽힘을 잰다.
   */
  hand_z?: {
    hand_left?: number[][]
    hand_right?: number[][]
  }
  expr?: Expr[]
}

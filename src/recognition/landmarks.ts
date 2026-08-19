// 랜드마크 → 고정 길이 특징 벡터 변환.
//
// MediaPipe HolisticLandmarker(웹캠)와 학습 스크립트(합성 데이터)가 **완전히 동일한**
// 특징 표현을 쓰도록, 특징 정의를 이 한 파일에 모은다. 여기 상수를 바꾸면 반드시
// 모델을 재학습해야 한다(FEATURE_DIM이 모델 입력 차원이므로).

export interface Landmark {
  x: number
  y: number
  z: number
  visibility?: number
}

/** MediaPipe Holistic 한 프레임의 원시 랜드마크(이미지 정규화 좌표 [0,1]). */
export interface LandmarkFrame {
  pose: Landmark[] // 33점 (없으면 빈 배열)
  leftHand: Landmark[] // 21점 (없으면 빈 배열)
  rightHand: Landmark[] // 21점 (없으면 빈 배열)
}

// 상반신 수어에 유의미한 포즈 관절만 선별(MediaPipe Pose 33점 인덱스).
// 코·양 어깨·팔꿈치·손목·엉덩이 → 9점. 얼굴/하반신 잡음 배제로 차원·노이즈 절감.
export const POSE_KEYS = [0, 11, 12, 13, 14, 15, 16, 23, 24] as const

// 특징 벡터 차원: 포즈 9×(x,y,z) + 양손 21×(x,y,z)×2 + 손 존재 플래그 2.
export const FEATURE_DIM = POSE_KEYS.length * 3 + 21 * 3 * 2 + 2 // = 27 + 126 + 2 = 155

// 분류 입력 시퀀스 길이(프레임). MediaPipe 실효 FPS(~15~25)에서 약 1.2~2초 동작.
export const SEQ_LEN = 32

/**
 * 한 프레임을 위치·스케일 불변 특징 벡터로 변환.
 * 어깨 중점을 원점, 어깨 너비를 스케일로 삼아 포즈·양손을 같은 좌표계로 정규화한다.
 * 어깨가 감지되지 않으면(수어 자세 아님) null을 반환해 해당 프레임을 버린다.
 */
export function frameToFeatures(frame: LandmarkFrame): Float32Array | null {
  const pose = frame.pose
  if (pose.length < 25) return null

  const lS = pose[11]
  const rS = pose[12]
  if (!lS || !rS) return null

  const cx = (lS.x + rS.x) / 2
  const cy = (lS.y + rS.y) / 2
  const cz = (lS.z + rS.z) / 2
  const dx = lS.x - rS.x
  const dy = lS.y - rS.y
  const shoulderWidth = Math.hypot(dx, dy)
  if (shoulderWidth < 1e-4) return null
  const inv = 1 / shoulderWidth

  const out = new Float32Array(FEATURE_DIM)
  let o = 0

  const push = (p: Landmark) => {
    out[o++] = (p.x - cx) * inv
    out[o++] = (p.y - cy) * inv
    out[o++] = (p.z - cz) * inv
  }

  // 미검출 관절은 **0으로 남긴다**(원점 좌표를 정규화해 넣지 않는다).
  // 예전에는 미검출 시 ZERO 랜드마크를 그대로 변환해 넣었는데, 그러면 손이 없을 때의
  // 값이 `(-cx, -cy, -cz) * inv` 즉 **몸 위치에 따라 달라지는 값**이 되어 버린다.
  // 모델 입장에선 "손 없음"이 매번 다른 벡터로 보이는 잡음이다. 0 + 존재 플래그(아래)가
  // 훨씬 일관된 신호다. 파이썬 학습 코드(ml/signbridge/features.py)도 같은 규칙을 쓴다.
  for (const idx of POSE_KEYS) {
    const p = pose[idx]
    if (p) push(p)
    else o += 3 // out은 0으로 초기화돼 있다.
  }

  const hasLeft = frame.leftHand.length === 21
  const hasRight = frame.rightHand.length === 21
  if (hasLeft) for (let i = 0; i < 21; i++) push(frame.leftHand[i])
  else o += 21 * 3
  if (hasRight) for (let i = 0; i < 21; i++) push(frame.rightHand[i])
  else o += 21 * 3

  out[o++] = hasLeft ? 1 : 0
  out[o++] = hasRight ? 1 : 0

  return out
}

/**
 * 가변 길이 특징 프레임 배열을 SEQ_LEN 길이로 균일 리샘플링.
 * (동작 속도 편차를 흡수 — 학습/추론 모두 여기로 통일.)
 * 반환: [SEQ_LEN, FEATURE_DIM] 평탄화된 Float32Array.
 */
export function resampleSequence(frames: Float32Array[], seqLen = SEQ_LEN): Float32Array {
  const out = new Float32Array(seqLen * FEATURE_DIM)
  if (frames.length === 0) return out
  for (let t = 0; t < seqLen; t++) {
    const src = frames.length === 1 ? 0 : Math.round((t * (frames.length - 1)) / (seqLen - 1))
    out.set(frames[src], t * FEATURE_DIM)
  }
  return out
}

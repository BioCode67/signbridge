/**
 * 손모양 — 손가락 굽힘을 재는 **한 곳**.
 *
 * `glbRetarget.ts`(아바타 재생)와 `scripts/check_handshape.mjs`(검사)가 같은
 * 함수를 쓴다. 두 벌로 두면 "검사는 통과하는데 화면은 다르다"가 되고, 이 프로젝트에서
 * 그 실패가 가장 찾기 어렵다(features.py ↔ landmarks.ts와 같은 부류다).
 *
 * 굽힘은 **손가락당 하나**로 잰다. 뿌리→끝 직선거리 ÷ 마디 합 = 줄자 비율.
 * 투영에 강해서(손가락이 카메라를 향해도 분자·분모가 함께 준다) 깊이가 없어도
 * 굽힘 정도가 살아남는다.
 */
export const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'] as const
export type Finger = (typeof FINGERS)[number]

export const HAND_SEGS: Record<string, [number, number][]> = {
  Thumb: [[1, 2], [2, 3], [3, 4]],
  Index: [[5, 6], [6, 7], [7, 8]],
  Middle: [[9, 10], [10, 11], [11, 12]],
  Ring: [[13, 14], [14, 15], [15, 16]],
  Pinky: [[17, 18], [18, 19], [19, 20]],
}

/** 마디별 최대 굽힘(라디안). 엄지는 다른 손가락보다 덜 굽는다. */
export const FLEX_SHARE: Record<string, number[]> = {
  Thumb: [0.62, 0.95, 0.55],
  Index: [1.30, 1.45, 0.85],
  Middle: [1.32, 1.48, 0.88],
  Ring: [1.30, 1.45, 0.85],
  Pinky: [1.22, 1.40, 0.82],
}

/** 쉬는 손의 바닥 굽힘. 0이면 아바타가 손을 자로 잰 듯 쫙 편 채로 든다. */
export const CURL_REST = 0.12

/** 줄자 비율 → 굽힘(0~1). 1.0이면 곧게, 0.35 이하면 완전히 쥔 것으로 본다. */
export function curlOf(ratio: number): number {
  const c = (1 - ratio) / 0.65
  const clamped = c < 0 ? 0 : c > 1 ? 1 : c
  return CURL_REST + (1 - CURL_REST) * clamped
}

/** 한 프레임의 손 키포인트(21점 × [x,y,vis])에서 손가락 5개의 굽힘을 낸다.
 *  깊이(`hz`, 21칸)가 있으면 3D 거리로 잰다. 잴 수 없는 손가락은 `null`. */
export function fingerCurls(h: number[] | Float32Array, hz?: number[] | null): (number | null)[] {
  const px = (i: number) => h[i * 3]
  const py = (i: number) => h[i * 3 + 1]
  const dist = (i: number, j: number) => {
    const dx = px(j) - px(i)
    const dy = py(j) - py(i)
    if (!hz) return Math.hypot(dx, dy)
    const az = hz[i], bz = hz[j]
    if (az === 0 && bz === 0) return Math.hypot(dx, dy)
    return Math.sqrt(dx * dx + dy * dy + (bz - az) * (bz - az))
  }
  return FINGERS.map((fg) => {
    const segs = HAND_SEGS[fg]
    let chain = 0
    for (const [a, b] of segs) {
      if ((px(a) === 0 && py(a) === 0) || (px(b) === 0 && py(b) === 0)) return null
      chain += dist(a, b)
    }
    if (chain <= 1e-3) return null
    return curlOf(dist(segs[0][0], segs[2][1]) / chain)
  })
}

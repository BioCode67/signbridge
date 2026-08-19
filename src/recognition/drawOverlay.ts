// 랜드마크를 캔버스에 오버레이(포즈 뼈대 + 양손). 좌우 반전(거울) 표시.
import type { Landmark, LandmarkFrame } from './landmarks'

// MediaPipe Pose 상반신 연결(인덱스 쌍).
const POSE_BONES: [number, number][] = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
]

// 손가락 연결(21점 표준).
const HAND_BONES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17],
]

export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  frame: LandmarkFrame,
  w: number,
  h: number,
): void {
  ctx.clearRect(0, 0, w, h)
  // 거울 표시: x를 반전.
  const X = (p: Landmark) => (1 - p.x) * w
  const Y = (p: Landmark) => p.y * h

  const bones = (pts: Landmark[], links: [number, number][], color: string, lw: number) => {
    if (pts.length === 0) return
    ctx.strokeStyle = color
    ctx.lineWidth = lw
    ctx.lineCap = 'round'
    for (const [a, b] of links) {
      const pa = pts[a]
      const pb = pts[b]
      if (!pa || !pb) continue
      ctx.beginPath()
      ctx.moveTo(X(pa), Y(pa))
      ctx.lineTo(X(pb), Y(pb))
      ctx.stroke()
    }
  }
  const dots = (pts: Landmark[], color: string, r: number) => {
    ctx.fillStyle = color
    for (const p of pts) {
      ctx.beginPath()
      ctx.arc(X(p), Y(p), r, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  bones(frame.pose, POSE_BONES, 'rgba(34,211,238,0.85)', 4) // cyan
  dots(frame.pose.filter((_, i) => i <= 24), 'rgba(103,232,249,0.95)', 3)
  bones(frame.leftHand, HAND_BONES, 'rgba(163,230,53,0.9)', 3) // lime
  dots(frame.leftHand, 'rgba(217,249,157,0.95)', 2.5)
  bones(frame.rightHand, HAND_BONES, 'rgba(251,191,36,0.9)', 3) // amber
  dots(frame.rightHand, 'rgba(253,230,138,0.95)', 2.5)
}

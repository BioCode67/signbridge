/**
 * Canvas 2D avatar / skeleton renderer.
 *
 * This is a faithful port of the proven playback logic in the original
 * `signbridge_demo.html`. The drawing math (coordinate mapping, bone tables,
 * limb / hand / head construction, expression-driven brows + mouth) is kept
 * identical so the React app reproduces the verified demo exactly.
 */
import type { SignData } from './signTypes'

export type ViewMode = 'avatar' | 'skeleton'

// ---- Pose joint indices (OpenPose BODY_25 subset we use) ----
const NOSE = 0
const NECK = 1
const RSH = 2
const REL = 3
const RWR = 4
const LSH = 5
const LEL = 6
const LWR = 7
const MIDHIP = 8

// ---- Bone tables ----
const POSE_BONES_S = [
  [1, 2], [2, 3], [3, 4], [1, 5], [5, 6], [6, 7], [1, 8], [1, 0],
] as const
const HAND_BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
] as const

// Source pixel bounds the capture lives in; mapped into the canvas with a
// 10% inset on every side.
const SRC = { minX: 650, maxX: 1350, minY: 200, maxY: 1100 }

/** Map joint `i` of a flat frame array to canvas backing-store pixels. */
function P(cv: HTMLCanvasElement, fr: number[], i: number): [number, number] {
  const x = (((fr[i * 3] - SRC.minX) / (SRC.maxX - SRC.minX)) * 0.8 + 0.1) * cv.width
  const y = (((fr[i * 3 + 1] - SRC.minY) / (SRC.maxY - SRC.minY)) * 0.8 + 0.1) * cv.height
  return [x, y]
}
/** Confidence of joint `i`. */
function C(fr: number[], i: number): number {
  return fr[i * 3 + 2]
}

// ===================== SKELETON MODE =====================
function drawSkelPart(
  ctx: CanvasRenderingContext2D,
  cv: HTMLCanvasElement,
  dpr: number,
  fr: number[],
  bones: readonly (readonly [number, number])[],
  color: string,
  jr: number,
  lw: number,
) {
  const n = fr.length / 3
  ctx.strokeStyle = color
  ctx.lineWidth = lw * dpr
  ctx.lineCap = 'round'
  for (const [a, b] of bones) {
    if (a >= n || b >= n || C(fr, a) < 0.1 || C(fr, b) < 0.1) continue
    const p = P(cv, fr, a)
    const q = P(cv, fr, b)
    ctx.globalAlpha = Math.min(C(fr, a), C(fr, b))
    ctx.beginPath()
    ctx.moveTo(p[0], p[1])
    ctx.lineTo(q[0], q[1])
    ctx.stroke()
  }
  ctx.fillStyle = color
  for (let i = 0; i < n; i++) {
    if (C(fr, i) < 0.1) continue
    const p = P(cv, fr, i)
    ctx.globalAlpha = C(fr, i)
    ctx.beginPath()
    ctx.arc(p[0], p[1], jr * dpr, 0, 7)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

function renderSkeleton(
  ctx: CanvasRenderingContext2D,
  cv: HTMLCanvasElement,
  dpr: number,
  data: SignData,
  frame: number,
) {
  const fr = data.keypoints.pose[frame]
  ctx.shadowColor = '#22d3ee'
  ctx.shadowBlur = 12 * dpr
  drawSkelPart(ctx, cv, dpr, fr, POSE_BONES_S, '#22d3ee', 4, 3)
  ctx.shadowBlur = 8 * dpr
  drawSkelPart(ctx, cv, dpr, data.keypoints.hand_left[frame], HAND_BONES, '#7dd3fc', 2.5, 2)
  drawSkelPart(ctx, cv, dpr, data.keypoints.hand_right[frame], HAND_BONES, '#7dd3fc', 2.5, 2)
  ctx.shadowBlur = 0
}

// ===================== AVATAR MODE =====================
function smoothLimb(
  ctx: CanvasRenderingContext2D,
  cv: HTMLCanvasElement,
  dpr: number,
  fr: number[],
  a: number,
  b: number,
  wA: number,
  wB: number,
  color: [string, string],
) {
  if (C(fr, a) < 0.1 || C(fr, b) < 0.1) return
  const p = P(cv, fr, a)
  const q = P(cv, fr, b)
  const dx = q[0] - p[0]
  const dy = q[1] - p[1]
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  const d = dpr
  const g = ctx.createLinearGradient(
    p[0] - nx * wA * d, p[1] - ny * wA * d,
    p[0] + nx * wA * d, p[1] + ny * wA * d,
  )
  g.addColorStop(0, color[0])
  g.addColorStop(1, color[1])
  ctx.fillStyle = g
  ctx.strokeStyle = g
  ctx.beginPath()
  ctx.moveTo(p[0] + nx * wA * d, p[1] + ny * wA * d)
  ctx.lineTo(q[0] + nx * wB * d, q[1] + ny * wB * d)
  ctx.lineTo(q[0] - nx * wB * d, q[1] - ny * wB * d)
  ctx.lineTo(p[0] - nx * wA * d, p[1] - ny * wA * d)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.arc(p[0], p[1], wA * d, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(q[0], q[1], wB * d, 0, Math.PI * 2)
  ctx.fill()
}

function handShape(
  ctx: CanvasRenderingContext2D,
  cv: HTMLCanvasElement,
  dpr: number,
  fr: number[],
  skin: [string, string],
) {
  const d = dpr
  const w = P(cv, fr, 0)
  const base = C(fr, 9) >= 0.1 ? P(cv, fr, 9) : w
  const cx = w[0] * 0.45 + base[0] * 0.55
  const cy = w[1] * 0.45 + base[1] * 0.55
  const SCALE = 0.72
  const sp = (i: number): [number, number] => {
    const p = P(cv, fr, i)
    return [cx + (p[0] - cx) * SCALE, cy + (p[1] - cy) * SCALE]
  }
  const g = ctx.createRadialGradient(cx, cy - 3 * d, 2, cx, cy, 15 * d)
  g.addColorStop(0, skin[0])
  g.addColorStop(1, skin[1])
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(cx, cy, 11 * d, 0, 7)
  ctx.fill()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const fingers = [
    [0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [0, 9, 10, 11, 12],
    [0, 13, 14, 15, 16], [0, 17, 18, 19, 20],
  ]
  for (const fg of fingers) {
    const seq = fg.filter((idx) => idx < fr.length / 3 && (C(fr, idx) >= 0.1 || idx === 0))
    if (seq.length < 2) continue
    ctx.strokeStyle = skin[0]
    for (let k = 0; k < seq.length - 1; k++) {
      const a = sp(seq[k])
      const b = sp(seq[k + 1])
      ctx.lineWidth = Math.max(4 * d, (8 - k * 1.0) * d)
      ctx.beginPath()
      ctx.moveTo(a[0], a[1])
      ctx.lineTo(b[0], b[1])
      ctx.stroke()
    }
    const tip = sp(seq[seq.length - 1])
    ctx.fillStyle = skin[0]
    ctx.beginPath()
    ctx.arc(tip[0], tip[1], 3.5 * d, 0, 7)
    ctx.fill()
  }
}

function renderAvatar(
  ctx: CanvasRenderingContext2D,
  cv: HTMLCanvasElement,
  dpr: number,
  data: SignData,
  frame: number,
) {
  const fr = data.keypoints.pose[frame]
  const d = dpr
  // Clean professional flat palette — a news-anchor look that matches the site.
  const SKIN: [string, string] = ['#f4cfa9', '#e3aa7e']
  const SUIT: [string, string] = ['#28374f', '#161e2e'] // navy jacket
  const SUIT_DK: [string, string] = ['#1e2940', '#10172a'] // shaded sleeve
  const SHIRT_WHITE = '#eef3fb'
  const TIE: [string, string] = ['#22d3ee', '#0e7490']
  const HAIR = '#241b14'

  // Torso — suit jacket with white shirt V + cyan tie
  if (C(fr, NECK) > 0.1 && C(fr, RSH) > 0.1 && C(fr, LSH) > 0.1) {
    const neck = P(cv, fr, NECK)
    const rsh = P(cv, fr, RSH)
    const lsh = P(cv, fr, LSH)
    const hip = C(fr, MIDHIP) > 0.1 ? P(cv, fr, MIDHIP) : [neck[0], neck[1] + 230 * d]
    const shMidX = (rsh[0] + lsh[0]) / 2
    const wr = [shMidX + (rsh[0] - shMidX) * 0.82, hip[1]]
    const wl = [shMidX + (lsh[0] - shMidX) * 0.82, hip[1]]
    const g = ctx.createLinearGradient(shMidX, rsh[1], shMidX, hip[1])
    g.addColorStop(0, SUIT[0])
    g.addColorStop(1, SUIT[1])
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.moveTo(rsh[0], rsh[1])
    ctx.quadraticCurveTo(shMidX, rsh[1] - 10 * d, lsh[0], lsh[1])
    ctx.quadraticCurveTo(lsh[0] + 10 * d, (lsh[1] + wl[1]) / 2, wl[0], wl[1])
    ctx.quadraticCurveTo(shMidX, hip[1] + 16 * d, wr[0], wr[1])
    ctx.quadraticCurveTo(rsh[0] - 10 * d, (rsh[1] + wr[1]) / 2, rsh[0], rsh[1])
    ctx.closePath()
    ctx.fill()

    // White shirt collar V
    const cy0 = (rsh[1] + lsh[1]) / 2
    const chestY = cy0 + (hip[1] - cy0) * 0.6
    ctx.fillStyle = SHIRT_WHITE
    ctx.beginPath()
    ctx.moveTo(shMidX - 23 * d, cy0 + 1 * d)
    ctx.lineTo(shMidX + 23 * d, cy0 + 1 * d)
    ctx.lineTo(shMidX, chestY)
    ctx.closePath()
    ctx.fill()
    // Cyan tie
    const tg = ctx.createLinearGradient(shMidX, cy0, shMidX, chestY)
    tg.addColorStop(0, TIE[0])
    tg.addColorStop(1, TIE[1])
    ctx.fillStyle = tg
    ctx.beginPath()
    ctx.moveTo(shMidX - 5 * d, cy0 + 5 * d)
    ctx.lineTo(shMidX + 5 * d, cy0 + 5 * d)
    ctx.lineTo(shMidX + 8 * d, chestY - 3 * d)
    ctx.lineTo(shMidX, chestY + 7 * d)
    ctx.lineTo(shMidX - 8 * d, chestY - 3 * d)
    ctx.closePath()
    ctx.fill()
    // Subtle lapels
    ctx.strokeStyle = 'rgba(255,255,255,0.09)'
    ctx.lineWidth = 2 * d
    ctx.beginPath()
    ctx.moveTo(shMidX - 23 * d, cy0 + 1 * d)
    ctx.lineTo(shMidX - 5 * d, chestY + 26 * d)
    ctx.moveTo(shMidX + 23 * d, cy0 + 1 * d)
    ctx.lineTo(shMidX + 5 * d, chestY + 26 * d)
    ctx.stroke()
  }

  // Arms — jacket sleeve (upper) + skin forearm, soft cyan glow
  ctx.shadowColor = 'rgba(34,211,238,.26)'
  ctx.shadowBlur = 9 * d
  smoothLimb(ctx, cv, dpr, fr, RSH, REL, 18, 13, SUIT_DK)
  smoothLimb(ctx, cv, dpr, fr, REL, RWR, 12, 9, SKIN)
  smoothLimb(ctx, cv, dpr, fr, LSH, LEL, 18, 13, SUIT_DK)
  smoothLimb(ctx, cv, dpr, fr, LEL, LWR, 12, 9, SKIN)
  ctx.shadowBlur = 0

  // Wrist joints + hands
  for (const wi of [RWR, LWR]) {
    if (C(fr, wi) > 0.1) {
      const w = P(cv, fr, wi)
      ctx.fillStyle = SKIN[0]
      ctx.beginPath()
      ctx.arc(w[0], w[1], 10 * d, 0, 7)
      ctx.fill()
    }
  }
  handShape(ctx, cv, dpr, data.keypoints.hand_left[frame], SKIN)
  handShape(ctx, cv, dpr, data.keypoints.hand_right[frame], SKIN)

  // Head — clean, static neutral face (expression is fixed)
  if (C(fr, NECK) > 0.1) {
    const neck = P(cv, fr, NECK)
    const head = C(fr, NOSE) > 0.1 ? P(cv, fr, NOSE) : [neck[0], neck[1] - 70 * d]
    // Neck
    ctx.fillStyle = SKIN[1]
    ctx.lineWidth = 16 * d
    ctx.strokeStyle = SKIN[1]
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(neck[0], neck[1])
    ctx.lineTo(head[0], head[1] + 18 * d)
    ctx.stroke()
    const hx = head[0]
    const hy = head[1] - 22 * d
    // Face
    const fg = ctx.createRadialGradient(hx - 9 * d, hy - 10 * d, 4, hx, hy, 44 * d)
    fg.addColorStop(0, '#ffe9d2')
    fg.addColorStop(1, '#e7b489')
    ctx.fillStyle = fg
    ctx.beginPath()
    ctx.ellipse(hx, hy, 32 * d, 38 * d, 0, 0, 7)
    ctx.fill()
    // Ears
    ctx.fillStyle = '#e7b489'
    ctx.beginPath()
    ctx.arc(hx - 31 * d, hy + 3 * d, 5.5 * d, 0, 7)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(hx + 31 * d, hy + 3 * d, 5.5 * d, 0, 7)
    ctx.fill()
    // Hair (neat side-part)
    ctx.fillStyle = HAIR
    ctx.beginPath()
    ctx.moveTo(hx - 34 * d, hy + 4 * d)
    ctx.quadraticCurveTo(hx - 40 * d, hy - 34 * d, hx - 2 * d, hy - 38 * d)
    ctx.quadraticCurveTo(hx + 40 * d, hy - 36 * d, hx + 34 * d, hy + 2 * d)
    ctx.quadraticCurveTo(hx + 18 * d, hy - 19 * d, hx + 2 * d, hy - 18 * d)
    ctx.quadraticCurveTo(hx - 18 * d, hy - 17 * d, hx - 34 * d, hy + 4 * d)
    ctx.closePath()
    ctx.fill()
    // Brows (static, neutral)
    ctx.strokeStyle = HAIR
    ctx.lineWidth = 2.6 * d
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(hx - 17 * d, hy - 6 * d)
    ctx.quadraticCurveTo(hx - 11 * d, hy - 9 * d, hx - 5 * d, hy - 7 * d)
    ctx.moveTo(hx + 5 * d, hy - 7 * d)
    ctx.quadraticCurveTo(hx + 11 * d, hy - 9 * d, hx + 17 * d, hy - 6 * d)
    ctx.stroke()
    // Eyes
    for (const eo of [-11, 11]) {
      ctx.fillStyle = '#fff'
      ctx.beginPath()
      ctx.ellipse(hx + eo * d, hy + 3 * d, 4.6 * d, 5.6 * d, 0, 0, 7)
      ctx.fill()
      ctx.fillStyle = '#33261b'
      ctx.beginPath()
      ctx.arc(hx + eo * d, hy + 4 * d, 2.7 * d, 0, 7)
      ctx.fill()
      ctx.fillStyle = '#fff'
      ctx.beginPath()
      ctx.arc(hx + eo * d - 1 * d, hy + 2.6 * d, 0.9 * d, 0, 7)
      ctx.fill()
    }
    // Mouth — gentle neutral curve (static)
    ctx.strokeStyle = '#b56a5b'
    ctx.lineWidth = 2.6 * d
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(hx - 8 * d, hy + 21 * d)
    ctx.quadraticCurveTo(hx, hy + 24 * d, hx + 8 * d, hy + 21 * d)
    ctx.stroke()
  }
}

/**
 * Draw a single frame. The canvas backing store (`canvas.width/height`) must
 * already be sized; we clear and paint either the avatar or the skeleton.
 */
export function drawFrame(
  canvas: HTMLCanvasElement,
  data: SignData,
  frame: number,
  mode: ViewMode,
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const dpr = window.devicePixelRatio || 1
  const f = Math.max(0, Math.min(frame, data.num_frames - 1))
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  if (!data.keypoints.pose[f]) return
  if (mode === 'avatar') renderAvatar(ctx, canvas, dpr, data, f)
  else renderSkeleton(ctx, canvas, dpr, data, f)
}

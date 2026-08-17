// 글로스열 → 아바타가 재생할 동작. **서버 없이 브라우저에서** 합성한다.
//
// server/app.py의 `/compose`와 같은 일을 하되, 정적 배포(GitHub Pages)에서도 돌도록
// TypeScript로 옮긴 것이다. 조각(글로스별 실연 동작)은 `public/data/glosses/`에서
// 정적 파일로 받는다.
//
// ── 왜 정규화가 필요한가
// 조각마다 촬영한 사람·거리·화면 위치가 다르다. 그대로 이으면 단어가 바뀔 때마다
// 아바타가 순간이동한다. 그래서 각 조각을 **어깨중점 원점 · 어깨너비 스케일**로 옮긴 뒤
// 공통 화면 좌표로 되돌리고, 조각 사이에 몇 프레임을 보간해 잇는다.
import type { SignData } from './signTypes'

const BANK_FPS = 30
const BLEND_FRAMES = 6
/** 표준 화면 좌표 — 기존 sign_N.json과 같은 픽셀계로 맞춘다. */
const CANVAS_CENTER: [number, number] = [960, 540]
const CANVAS_SHOULDER = 260
/** OpenPose BODY_25의 어깨 인덱스. */
const R_SHOULDER = 2
const L_SHOULDER = 5

export interface BankEntry {
  file: string
  frames: number
  fps: number
  has3d?: boolean
}
export type BankIndex = Record<string, BankEntry>

type Piece = { pose: number[][]; hand_left: number[][]; hand_right: number[][] }

function normalizePiece(entry: SignData): Piece {
  const src = entry.keypoints
  const frames = src.pose.length
  const out: Piece = { pose: [], hand_left: [], hand_right: [] }

  for (let f = 0; f < frames; f++) {
    const pose = src.pose[f]
    const rx = pose[R_SHOULDER * 3]
    const ry = pose[R_SHOULDER * 3 + 1]
    const lx = pose[L_SHOULDER * 3]
    const ly = pose[L_SHOULDER * 3 + 1]
    const cx = (rx + lx) / 2
    const cy = (ry + ly) / 2
    let width = Math.hypot(lx - rx, ly - ry)
    // 어깨 미검출 프레임 보호 — 0으로 나누면 좌표가 전부 무한대가 된다.
    if (!(width > 1e-3)) width = CANVAS_SHOULDER

    const remap = (flat: number[]): number[] => {
      const dst = flat.slice()
      for (let i = 0; i * 3 < flat.length; i++) {
        const xi = i * 3
        const yi = i * 3 + 1
        // OpenPose 미검출은 정확히 0 — 옮기면 안 된다(0으로 남겨야 건너뛴다).
        dst[xi] = flat[xi] === 0 ? 0 : ((flat[xi] - cx) / width) * CANVAS_SHOULDER + CANVAS_CENTER[0]
        dst[yi] = flat[yi] === 0 ? 0 : ((flat[yi] - cy) / width) * CANVAS_SHOULDER + CANVAS_CENTER[1]
      }
      return dst
    }

    out.pose.push(remap(pose))
    out.hand_left.push(remap(src.hand_left[f] ?? []))
    out.hand_right.push(remap(src.hand_right[f] ?? []))
  }
  return out
}

/** 두 조각 사이를 선형 보간. 어느 한쪽이 미검출(0)인 점은 보간하지 않는다. */
function blend(a: number[], b: number[], steps: number): number[][] {
  const out: number[][] = []
  for (let s = 1; s <= steps; s++) {
    const t = s / (steps + 1)
    const row = new Array(a.length)
    for (let i = 0; i < a.length; i++) {
      row[i] = a[i] === 0 || b[i] === 0 ? 0 : a[i] * (1 - t) + b[i] * t
    }
    out.push(row)
  }
  return out
}

export interface ComposeResult extends SignData {
  /** 동작 사전에 없어 건너뛴 글로스 */
  gloss_missing: string[]
}

/**
 * 글로스열을 이어 붙여 재생 가능한 SignData를 만든다.
 * `loadGloss`는 글로스 이름 → 조각 데이터를 돌려주는 함수(캐시는 호출부 책임).
 */
export async function composeGlosses(
  text: string,
  glosses: string[],
  bank: BankIndex,
  loadGloss: (name: string, entry: BankEntry) => Promise<SignData>,
): Promise<ComposeResult | null> {
  const pieces: Piece[] = []
  const timeline: { gloss: string; start: number; end: number }[] = []
  const missing: string[] = []
  let cursor = 0

  for (const gloss of glosses) {
    const entry = bank[gloss]
    if (!entry) {
      missing.push(gloss)
      continue
    }
    let piece: Piece
    try {
      piece = normalizePiece(await loadGloss(gloss, entry))
    } catch {
      missing.push(gloss)
      continue
    }
    if (piece.pose.length === 0) {
      missing.push(gloss)
      continue
    }

    if (pieces.length > 0) {
      const prev = pieces[pieces.length - 1]
      const last = prev.pose.length - 1
      pieces.push({
        pose: blend(prev.pose[last], piece.pose[0], BLEND_FRAMES),
        hand_left: blend(prev.hand_left[last], piece.hand_left[0], BLEND_FRAMES),
        hand_right: blend(prev.hand_right[last], piece.hand_right[0], BLEND_FRAMES),
      })
      cursor += BLEND_FRAMES
    }

    const start = cursor / BANK_FPS
    pieces.push(piece)
    cursor += piece.pose.length
    timeline.push({ gloss, start, end: cursor / BANK_FPS })
  }

  if (pieces.length === 0) return null

  const merged: Piece = { pose: [], hand_left: [], hand_right: [] }
  for (const p of pieces) {
    merged.pose.push(...p.pose)
    merged.hand_left.push(...p.hand_left)
    merged.hand_right.push(...p.hand_right)
  }

  return {
    korean_text: text,
    fps: BANK_FPS,
    num_frames: merged.pose.length,
    gloss_sequence: timeline,
    keypoints: merged,
    gloss_missing: missing,
  }
}

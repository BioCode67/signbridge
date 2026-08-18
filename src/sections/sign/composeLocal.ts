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

/** 고개 동작 표 — `public/data/nonmanual.json`. 없으면 그냥 안 붙는다.
 *
 *  원본 비수지 주석에서 **어느 낱말에 고개 끄덕임·흔들기가 함께 나오는지** 재고
 *  (문장 200,873건), 뜻이 분명한 것만 사람이 확정했다. 부정에는 젓기, 당부에는
 *  끄덕임 — 수어 문법과 그대로 맞는다(거절 ×45 · 불가능 ×31 · 하지마 ×16 ·
 *  조심 ×6.5 · 부탁 ×4.0).
 *
 *  **눈썹은 넣지 않는다.** 주석에 올림/찌푸림 방향이 없고, 판정 의문문과 설명
 *  의문문은 방향이 반대다 — 지어내면 틀린 문법을 가르치는 셈이다. */
let headTable: { nod: Record<string, number>; shake: Record<string, number> } | null = null
let headLoading: Promise<void> | null = null
function loadHeadTable(base: string): Promise<void> {
  if (headLoading) return headLoading
  headLoading = fetch(`${base}data/nonmanual.json`)
    .then((r) => (r.ok ? r.json() : null))
    .then((t) => {
      headTable = t?.nod && t?.shake ? t : null
    })
    .catch(() => {
      headTable = null
    })
  return headLoading
}

/** 글로스 이름에서 이형태 번호를 뗀 표제어 — 표는 표제어로 되어 있다. */
const headLemma = (g: string) => g.replace(/[0-9#:@]+$/, '')

function headMotion(gloss: string): 'nod' | 'shake' | undefined {
  if (!headTable) return undefined
  const l = headLemma(gloss)
  if (headTable.shake[l]) return 'shake'
  if (headTable.nod[l]) return 'nod'
  return undefined
}
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
    const lin = s / (steps + 1)
    // ease-in-out(코사인) — 등속 선형 보간은 팔이 미끄러지듯 움직여 로봇처럼 보인다.
    // 실제 팔 동작은 가속-감속 곡선을 그린다.
    const t = (1 - Math.cos(Math.PI * lin)) / 2
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
  /** 조각을 내려받는 데 쓴 시간(ms) — 캐시가 차면 0에 가까워진다 */
  fetchMs: number
  /** 좌표 정규화·연결에 쓴 순수 계산 시간(ms) */
  buildMs: number
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
  const timeline: { gloss: string; start: number; end: number; head?: 'nod' | 'shake' }[] = []
  const missing: string[] = []
  let cursor = 0

  // **조각을 병렬로 먼저 받는다.** 루프 안에서 하나씩 await하면 왕복이 직렬로 쌓여
  // 10단어 문장에 십수 초가 걸린다(실측 14.7초). 실시간이라 부를 수 없는 수치였다.
  const tFetch0 = performance.now()
  // 고개 동작 표는 한 번만 받아 둔다(작다). 실패해도 합성은 그대로 진행된다.
  void loadHeadTable(import.meta.env.BASE_URL)
  const unique = [...new Set(glosses)].filter((g) => bank[g])
  const loaded = new Map<string, SignData>()
  await Promise.all(
    unique.map(async (g) => {
      try {
        loaded.set(g, await loadGloss(g, bank[g]))
      } catch {
        /* 이 글로스는 missing으로 떨어진다 */
      }
    }),
  )

  const tBuild0 = performance.now()

  for (const gloss of glosses) {
    const entry = bank[gloss]
    const raw = entry ? loaded.get(gloss) : undefined
    if (!entry || !raw) {
      missing.push(gloss)
      continue
    }
    const piece = normalizePiece(raw)
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
    timeline.push({ gloss, start, end: cursor / BANK_FPS, head: headMotion(gloss) })
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
    fetchMs: tBuild0 - tFetch0,
    buildMs: performance.now() - tBuild0,
  }
}

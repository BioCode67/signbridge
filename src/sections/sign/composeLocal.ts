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

/** 마우징 표 — 글로스 → 입으로 내는 한국어 낱말.
 *
 *  `Mmo` 채널만 `descriptor`(무엇을)가 채워져 있어 이것만 만들 수 있다.
 *  눈썹(EBf 7건)·고개(Hno 10건)는 "언제"만 있고 "어떻게"가 비어 있다. */
let mouthTable: Record<string, string> | null = null
let mouthLoading: Promise<void> | null = null
function loadMouthTable(base: string): Promise<void> {
  if (mouthLoading) return mouthLoading
  mouthLoading = fetch(`${base}data/mouthing.json`)
    .then((r) => (r.ok ? r.json() : null))
    .then((t) => {
      mouthTable = t && typeof t === 'object' ? t : null
    })
    .catch(() => {
      mouthTable = null
    })
  return mouthLoading
}

/** 순한글 낱말인가 — 숫자·기호·`시:9시`·`날짜:6월23일` 같은 이름은 뺀다. */
const PLAIN_KOREAN = /^[가-힣]{1,5}$/

function mouthOf(gloss: string): string | undefined {
  const lemma = headLemma(gloss)
  const hit = mouthTable?.[gloss] ?? mouthTable?.[lemma]
  if (hit) return hit
  // **표에 없으면 글로스 이름 그대로 발음한다.**
  //
  // 지어내는 것이 아니다 — 실측으로 확인한 기본값이다. 원본에서 뽑은 마우징
  // 2,081종 가운데 **1,535종(73.8%)이 글로스 이름과 같았다.** 마우징은 원래
  // "지금 하는 수어의 한국어 낱말"을 입으로 내는 것이라 그렇다.
  //
  // 이 되돌림이 없으면 `안전1`·`대피0`·`화재`·숫자처럼 **가장 자주 나오는
  // 낱말들이 통째로 입을 다문다**(실측: 수록률 46.9%에서 멈췄다). 원본은
  // 재난문자 225개 문장에서 뽑은 것이라 창구·일상 낱말이 거의 없다.
  //
  // 뜻이 어긋날 위험은 낮다 — 입이 내는 것이 곧 지금 하는 수어의 이름이다.
  // 다만 `시:9시`·`날짜:6월23일`·`물결표1`처럼 이름이 낱말이 아닌 것은 뺀다.
  return PLAIN_KOREAN.test(lemma) ? lemma : undefined
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
/** 조각과 조각 사이에 끼워 넣는 이음매 프레임 수(30fps 기준).
 *
 *  **실제 수어자를 재서 정했다.** AI Hub 수어스크립트 문장 19,759개에서 이어진
 *  글로스 176,198쌍의 틈을 쟀더니 중앙값 **0.252초 = 7.6프레임**이었다
 *  (p25 0.122초 · p75 0.774초 · 겹치는 경우 0%). 6프레임(0.2초)은 사람보다
 *  20% 빨랐다. 중앙값에 맞춰 8로 둔다.
 *
 *  p75가 23프레임까지 벌어지는 것은 **구 경계**로 보인다 — 문장 안에서도 쉬는
 *  자리가 있다는 뜻이다. 지금은 모든 이음매를 같은 길이로 둔다. 구 경계를
 *  길게 두는 것이 더 자연스러운지는 **재 본 적이 없어** 손대지 않았다
 *  (9월 당사자 평가에서 물어볼 목록에 넣었다). */
const BLEND_FRAMES = 8
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

type Piece = {
  pose: number[][]
  hand_left: number[][]
  hand_right: number[][]
  /** 손 깊이(z) — 조각에 있으면 함께 옮긴다.
   *
   *  **없으면 합성 문장에는 깊이가 하나도 안 남는다.** 조각 하나를 그대로
   *  재생하는 사전 탭에서만 깊이가 살고, 정작 받기·묻기의 문장은 2D로만
   *  돌아간다(2026-08-20에 이 상태였다). 이음매 보간도 함께 해 줘야
   *  조각이 바뀔 때 손가락이 튀지 않는다. */
  hz_left?: number[][]
  hz_right?: number[][]
}

function normalizePiece(entry: SignData): Piece {
  const src = entry.keypoints
  const frames = src.pose.length
  const out: Piece = { pose: [], hand_left: [], hand_right: [] }
  // 깊이는 어깨 폭으로 함께 정규화한다 — x·y와 같은 자로 재야 3D 거리가 맞다.
  const hz = entry.hand_z
  const zl: number[][] | undefined = hz?.hand_left ? [] : undefined
  const zr: number[][] | undefined = hz?.hand_right ? [] : undefined

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
    // 깊이도 같은 배율로 — 손목 기준 상대값이라 평행이동은 필요 없다.
    const zscale = (row: number[] | undefined): number[] =>
      (row ?? []).map((v) => (v === 0 ? 0 : (v / width) * CANVAS_SHOULDER))
    if (zl) zl.push(zscale(hz?.hand_left?.[f]))
    if (zr) zr.push(zscale(hz?.hand_right?.[f]))
  }
  if (zl) out.hz_left = zl
  if (zr) out.hz_right = zr
  return out
}

/** 깊이 한 줄(점 21개)을 두 조각 사이에서 보간. 좌표 보간과 같은 곡선을 쓴다. */
function blendZ(a: number[], b: number[], steps: number): number[][] {
  const out: number[][] = []
  for (let s = 1; s <= steps; s++) {
    const t = (1 - Math.cos((s / (steps + 1)) * Math.PI)) / 2
    const row: number[] = []
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const av = a[i] ?? 0
      const bv = b[i] ?? 0
      // 한쪽이 미검출(0)이면 보간하지 않고 0으로 둔다 — 없는 깊이를 지어내지 않는다.
      row.push(av === 0 || bv === 0 ? 0 : av + (bv - av) * t)
    }
    out.push(row)
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
  const timeline: { gloss: string; start: number; end: number; head?: 'nod' | 'shake'; mouth?: string }[] = []
  const missing: string[] = []
  let cursor = 0

  // **조각을 병렬로 먼저 받는다.** 루프 안에서 하나씩 await하면 왕복이 직렬로 쌓여
  // 10단어 문장에 십수 초가 걸린다(실측 14.7초). 실시간이라 부를 수 없는 수치였다.
  const tFetch0 = performance.now()
  // 고개 동작 표는 한 번만 받아 둔다(작다). 실패해도 합성은 그대로 진행된다.
  // 배포 기준 경로는 **쓸 때 읽는다** — 검사 도구는 Node에서 이 파일을 불러오는데
  // 그때는 import.meta.env가 없다. 없으면 현재 경로 기준으로 둔다.
  //
  // **기다렸다 쓴다.** 시작만 걸어 두면 표가 도착하기 전에 타임라인이 끝나서
  // **첫 문장에만 고개 동작이 안 붙는다**(실측). 파일은 작고 한 번만 받으므로
  // 기다리는 비용이 없다시피 하다 — 두 번째 문장부터는 이미 끝나 있다.
  const base = import.meta.env?.BASE_URL ?? './'
  await loadHeadTable(base)
  await loadMouthTable(base)
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
      // 깊이도 함께 잇는다. 한쪽 조각에만 깊이가 있으면 **없는 쪽을 0으로** 채워
      // 부드럽게 사라지게 한다 — 갑자기 3D↔2D로 바뀌면 손가락이 튄다.
      const zlPrev = prev.hz_left?.[last]
      const zlNext = piece.hz_left?.[0]
      const zrPrev = prev.hz_right?.[last]
      const zrNext = piece.hz_right?.[0]
      const zeros = (n: number) => new Array(n).fill(0)
      const bridge = (a: number[] | undefined, b: number[] | undefined) => {
        if (!a && !b) return undefined
        const n = (a ?? b ?? []).length
        return blendZ(a ?? zeros(n), b ?? zeros(n), BLEND_FRAMES)
      }
      pieces.push({
        pose: blend(prev.pose[last], piece.pose[0], BLEND_FRAMES),
        hand_left: blend(prev.hand_left[last], piece.hand_left[0], BLEND_FRAMES),
        hand_right: blend(prev.hand_right[last], piece.hand_right[0], BLEND_FRAMES),
        hz_left: bridge(zlPrev, zlNext),
        hz_right: bridge(zrPrev, zrNext),
      })
      cursor += BLEND_FRAMES
    }

    const start = cursor / BANK_FPS
    pieces.push(piece)
    cursor += piece.pose.length
    timeline.push({ gloss, start, end: cursor / BANK_FPS, head: headMotion(gloss), mouth: mouthOf(gloss) })
  }

  if (pieces.length === 0) return null

  const merged: Piece = { pose: [], hand_left: [], hand_right: [], hz_left: [], hz_right: [] }
  let anyZ = false
  for (const p of pieces) {
    merged.pose.push(...p.pose)
    merged.hand_left.push(...p.hand_left)
    merged.hand_right.push(...p.hand_right)
    // 깊이가 없는 조각은 0으로 채운다 — 프레임 수가 어긋나면 엉뚱한 프레임의
    // 깊이를 쓰게 되어 손가락이 제멋대로 굽는다.
    const zeroRow = () => new Array(21).fill(0)
    for (let i = 0; i < p.pose.length; i++) {
      merged.hz_left!.push(p.hz_left?.[i] ?? zeroRow())
      merged.hz_right!.push(p.hz_right?.[i] ?? zeroRow())
    }
    if (p.hz_left || p.hz_right) anyZ = true
  }

  return {
    korean_text: text,
    fps: BANK_FPS,
    num_frames: merged.pose.length,
    gloss_sequence: timeline,
    keypoints: { pose: merged.pose, hand_left: merged.hand_left, hand_right: merged.hand_right },
    // 조각 중 하나라도 깊이가 있으면 싣는다. 없는 조각 자리는 0이라 그 구간만
    // 2D로 돌아간다 — 문장 전체가 3D냐 2D냐로 갈리지 않는다.
    ...(anyZ ? { hand_z: { hand_left: merged.hz_left, hand_right: merged.hz_right } } : {}),
    gloss_missing: missing,
    fetchMs: tBuild0 - tFetch0,
    buildMs: performance.now() - tBuild0,
  }
}

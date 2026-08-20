/**
 * 마우징 — 수어를 하면서 입으로 한국어 낱말을 소리 없이 발음하는 것.
 *
 * **장식이 아니다.** 같은 손동작이 여러 뜻을 가질 때 입모양이 뜻을 가른다.
 * 농인 당사자가 실제로 읽는 정보다.
 *
 * 표는 `public/data/mouthing.json`(글로스 → 한국어 낱말)에서 온다. AI Hub
 * 수어스크립트의 `Mmo` 채널을 글로스 구간과 겹쳐 만든 것이다
 * (`ml/tools/build_mouthing.py`). **지어내지 않는다** — 표에 없는 글로스는
 * 입을 다물고 있는다. 눈썹·고개는 원본에 `descriptor`가 비어 있어
 * "언제"만 알고 "어떻게"를 모르므로 여기서 만들지 않는다.
 *
 * 아바타는 Oculus 비짐(`viseme_aa`·`viseme_O`…)을 갖고 있다. 한글은 음절이
 * 초성·중성·종성으로 딱 갈라지므로 코드값 계산만으로 입모양이 나온다 —
 * 발음 사전이 필요 없다.
 */

/** 아바타가 실제로 갖고 있는 이름들(real-avaturn.glb에서 확인). */
export type Viseme =
  | 'viseme_sil' | 'viseme_PP' | 'viseme_FF' | 'viseme_TH' | 'viseme_DD'
  | 'viseme_kk' | 'viseme_CH' | 'viseme_SS' | 'viseme_nn' | 'viseme_RR'
  | 'viseme_aa' | 'viseme_E' | 'viseme_I' | 'viseme_O' | 'viseme_U'

const HANGUL_BASE = 0xac00
const HANGUL_LAST = 0xd7a3

/** 초성 19개 → 비짐. `ㅇ`은 소리가 없어 다음 모음이 그대로 보인다. */
const ONSET: (Viseme | null)[] = [
  'viseme_kk', // ㄱ
  'viseme_kk', // ㄲ
  'viseme_nn', // ㄴ
  'viseme_DD', // ㄷ
  'viseme_DD', // ㄸ
  'viseme_RR', // ㄹ
  'viseme_PP', // ㅁ  ← 입술을 붙인다
  'viseme_PP', // ㅂ
  'viseme_PP', // ㅃ
  'viseme_SS', // ㅅ
  'viseme_SS', // ㅆ
  null,        // ㅇ  (소리 없음)
  'viseme_CH', // ㅈ
  'viseme_CH', // ㅉ
  'viseme_CH', // ㅊ
  'viseme_kk', // ㅋ
  'viseme_DD', // ㅌ
  'viseme_PP', // ㅍ
  'viseme_TH', // ㅎ
]

/** 중성 21개 → 비짐. 입이 벌어지는 정도와 둥글기가 여기서 정해진다. */
const NUCLEUS: Viseme[] = [
  'viseme_aa', // ㅏ
  'viseme_E',  // ㅐ
  'viseme_aa', // ㅑ
  'viseme_E',  // ㅒ
  'viseme_E',  // ㅓ
  'viseme_E',  // ㅔ
  'viseme_E',  // ㅕ
  'viseme_E',  // ㅖ
  'viseme_O',  // ㅗ
  'viseme_aa', // ㅘ
  'viseme_E',  // ㅙ
  'viseme_E',  // ㅚ
  'viseme_O',  // ㅛ
  'viseme_U',  // ㅜ
  'viseme_E',  // ㅝ
  'viseme_E',  // ㅞ
  'viseme_I',  // ㅟ
  'viseme_U',  // ㅠ
  'viseme_U',  // ㅡ
  'viseme_I',  // ㅢ
  'viseme_I',  // ㅣ
]

/** 종성 28개(0=없음) → 입을 닫는 것만 본다. `ㅁ`·`ㅂ`·`ㅍ`은 입술이 붙는다. */
const CODA_CLOSE = new Set([16, 17, 18, 26]) // ㅁ ㅂ ㅄ ㅍ

export interface MouthFrame {
  /** 이 순간의 비짐과 세기(0~1). 없으면 입을 다문 것. */
  viseme: Viseme | null
  weight: number
  /** 턱이 벌어지는 정도(0~1) — 모음마다 다르다. */
  jaw: number
}

/** 모음별 턱 벌어짐. `ㅏ`가 가장 크고 `ㅣ`·`ㅜ`는 거의 안 벌어진다. */
const JAW: Record<string, number> = {
  viseme_aa: 0.55, viseme_E: 0.32, viseme_O: 0.30, viseme_U: 0.18, viseme_I: 0.12,
}

/** 한 음절을 초성·중성·종성으로 쪼갠다. 한글이 아니면 null. */
export function decompose(ch: string): { on: number; nu: number; co: number } | null {
  const c = ch.codePointAt(0)
  if (c === undefined || c < HANGUL_BASE || c > HANGUL_LAST) return null
  const i = c - HANGUL_BASE
  return { on: Math.floor(i / 588), nu: Math.floor((i % 588) / 28), co: i % 28 }
}

/**
 * 낱말 하나를 `frames` 프레임에 걸쳐 발음할 때의 입모양 열을 만든다.
 *
 * 음절마다 앞 35%는 초성, 나머지는 중성으로 본다 — 실제 조음도 자음이 짧고
 * 모음이 길다. 종성이 입술을 닫는 소리면 마지막 15%에서 입을 붙인다.
 */
export function mouthTimeline(word: string, frames: number): MouthFrame[] {
  const syls = [...word].map(decompose).filter((s): s is NonNullable<typeof s> => !!s)
  const out: MouthFrame[] = []
  if (!syls.length || frames <= 0) {
    for (let i = 0; i < Math.max(0, frames); i++) out.push({ viseme: null, weight: 0, jaw: 0 })
    return out
  }
  const per = frames / syls.length
  for (let i = 0; i < frames; i++) {
    const si = Math.min(syls.length - 1, Math.floor(i / per))
    const t = (i - si * per) / per // 이 음절 안에서의 위치 0~1
    const s = syls[si]
    const vowel = NUCLEUS[s.nu]
    let viseme: Viseme | null
    if (t < 0.35 && ONSET[s.on]) viseme = ONSET[s.on]
    else if (t > 0.85 && CODA_CLOSE.has(s.co)) viseme = 'viseme_PP'
    else viseme = vowel
    // 음절 경계에서 세기를 낮춘다 — 안 그러면 입이 딱딱 끊긴다.
    const edge = Math.min(t, 1 - t) / 0.2
    const weight = 0.55 + 0.45 * Math.min(1, edge)
    out.push({ viseme, weight, jaw: (JAW[vowel] ?? 0.25) * weight })
  }
  return out
}


// ── 시각·날짜 글로스의 입모양 ────────────────────────────────────────────
//
// `시:9시`·`날짜:6월23일` 같은 이름은 낱말이 아니라 숫자라서 그대로는 입을
// 움직일 수 없다. 그런데 재난문자에는 시각·날짜가 거의 문장마다 나온다 —
// 그 구간만 입이 다물려 있으면 눈에 띈다.
//
// **읽는 법은 지어내지 않는다.** 한국어 수 읽기는 규칙이 정해져 있고, 원본
// 주석자도 `시:9시 → 9시`처럼 숫자를 그대로 적어 두어 읽기를 알려 주지 않는다.
// 그래서 **국어 규칙 그대로** 옮긴다. 불규칙한 자리(유월·시월)까지 넣었다.

/** 한자어 수 — 분·일·월·년에 쓴다(십일, 이십삼…). */
const SINO_ONES = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구']
export function sinoNumber(n: number): string {
  if (n <= 0) return '공'
  if (n > 9999) return String(n)
  // 자리마다 `일`을 붙이지 않는다 — 100은 `일백`이 아니라 `백`이다.
  let out = ''
  for (const [unit, name] of [[1000, '천'], [100, '백'], [10, '십']] as const) {
    const d = Math.floor(n / unit) % 10
    if (d) out += (d > 1 ? SINO_ONES[d] : '') + name
  }
  return out + SINO_ONES[n % 10]
}

/** 고유어 수 — **시(時)에만** 쓴다(한 시, 두 시…). 열두 시까지. */
const NATIVE_HOUR = ['', '한', '두', '세', '네', '다섯', '여섯', '일곱', '여덟',
  '아홉', '열', '열한', '열두']

/** 달 이름 — **6월은 `유월`, 10월은 `시월`**이다(육월·십월이 아니다). */
function monthWord(m: number): string {
  if (m === 6) return '유월'
  if (m === 10) return '시월'
  return sinoNumber(m) + '월'
}

/**
 * 시각·날짜 글로스를 입으로 읽을 한국어로 바꾼다. 낱말이면 그대로 돌려준다.
 *
 *     시:9시       → 아홉시          (13시 이상은 한자어 — "이십일시")
 *     시:2시5분    → 두시오분
 *     날짜:6월23일 → 유월이십삼일
 */
/** 단위·기호 글로스의 한국어 읽기. 재난문자에 `3m`·`30mm`·`35℃`가 늘 나온다. */
const UNIT_WORD: Record<string, string> = {
  m: '미터', mm: '밀리미터', cm: '센티미터', km: '킬로미터', kg: '킬로그램',
  L: '리터', l: '리터', '%': '퍼센트', '℃': '도', C: '도', h: '시간', s: '초',
  '?': '무엇', '-': '마이너스', '.': '점', '/': '나누기',
}

export function readableGloss(gloss: string): string | null {
  // **꼴이 정해진 것부터 본다.** 숫자를 먼저 떼면 `시:9시`가 `시시`가 되어
  // 그대로 낱말처럼 통과한다(2026-08-20에 실제로 그렇게 넣었다가 검사가 잡았다).
  const time = /^시:(-?)(\d{1,2})시(?:(\d{1,2})분)?$/.exec(gloss)
  if (time) {
    const h = Number(time[2])
    // 0시는 `공시`가 아니라 **영시**다(`00시53분` → 영시오십삼분).
    const hour = h === 0 ? '영시'
      : h >= 1 && h <= 12 ? NATIVE_HOUR[h] + '시'
        : sinoNumber(h) + '시'
    const min = time[3] ? sinoNumber(Number(time[3])) + '분' : ''
    return hour + min
  }
  const date = /^날짜:(\d{1,2})월(\d{1,2})일$/.exec(gloss)
  if (date) return monthWord(Number(date[1])) + sinoNumber(Number(date[2])) + '일'
  // 숫자만 있는 글로스(`463`)도 한자어로 읽는다 — 네 자리까지.
  if (/^\d{1,4}$/.test(gloss)) return sinoNumber(Number(gloss))
  if (UNIT_WORD[gloss]) return UNIT_WORD[gloss]
  // 이형태 번호는 **가운데에도 들어간다**(`자동차2밀리다`). 전부 떼고 본다.
  const lemma = gloss.replace(/[0-9#:@]/g, '')
  // 여덟 음절까지 — `광주광역시청`·`세종특별자치시` 같은 이름도 입으로 낸다.
  return /^[가-힣]{1,8}$/.test(lemma) ? lemma : null
}

// 수어 낱말 묶음 → **의도**.
//
// 지금 인식기는 낱말 단위다(연속 문장 CTC는 학습 중). 그래서 "대피소 어디?"는
// 앱에 `["대피", "어디"]` 같은 낱말 묶음으로 도착한다. 문장 구조가 없으므로
// 구문 분석으로 뜻을 캐낼 수 없다 — 대신 **무엇을 묻는지**만 알아내면 된다.
// 창구·재난 상황에서 농인이 실제로 묻는 것은 그리 많지 않다.
//
// **후보를 함께 본다.** 모델의 1순위 정답률은 0.7868이지만 5순위 안에 들 확률은
// 0.9188이다(실측, 처음 보는 수어자 49,721표본). 1순위만 보면 다섯 번에 한 번은
// 의도를 놓치는데, 후보까지 보면 그 대부분을 건진다. 대신 순위가 낮은 후보는
// 가중치를 낮춰, 엉뚱한 의도가 튀어나오지 않게 한다.
//
// 판정에 못 미치면 **아무 의도도 아니라고 답한다**(null). 억지로 하나를 고르면
// 엉뚱한 대피소를 알려주게 된다 — 재난 상황에서 그것은 침묵보다 나쁘다.
import { glossLabel } from '../agents/glossLabel'
import type { PlaceKind } from './nearby'

export type Intent =
  | { kind: 'where'; place: PlaceKind }
  | { kind: 'whatsup' }   // 지금 무슨 일이에요?
  | { kind: 'howto' }     // 어떻게 해야 해요?
  | { kind: 'help' }      // 도와주세요

/** 갈래를 가리키는 낱말 — 앞에 있을수록 그 갈래의 핵심.
 *  **인식 모델의 클래스에 실존하는 낱말만** 넣는다(없는 낱말은 영영 안 맞는다).
 *  화장실은 iso-v1(8,147클래스)에는 없고 iso-v2(13,576)부터 인식된다.
 *
 *  이 규칙은 오래 지켜지지 않았다 — 실제로 재 보니 54개 중 10개가 모델이 낼 수
 *  없는 낱말이었다(피난·응급실·진료·파출소·변소·대변·어느·어디에·해야·위급).
 *  뜻이 통하는 실존 낱말로 갈아 끼웠다(응급실→의사·간호, 파출소→경찰,
 *  변소·대변→소변, 위급→구조). 없는 낱말은 뺐다.
 *  `scripts/check_intent_words.mjs`가 모델 클래스와 대조한다 — 모델을 갈아 끼울
 *  때마다 돌 것. 목록에 죽은 낱말이 있어도 오류는 나지 않는다. */
const PLACE_WORDS: Record<PlaceKind, string[]> = {
  shelter: ['대피', '도망', '장소', '학교', '초등학교', '운동장', '지하'],
  hospital: ['병원', '구급차', '치료', '의사', '간호'],
  pharmacy: ['약국', '약'],
  police: ['경찰서', '경찰'],
  subway: ['지하철', '역', '전철'],
  toilet: ['화장실', '소변'],
}

/** 장소를 묻는 신호 — 이 중 하나라도 있으면 "어디?" 질문으로 본다. */
const WHERE_WORDS = ['어디', '위치', '찾다', '가다']
/** 상황을 묻는 신호 */
const WHATSUP_WORDS = ['무엇', '뭐', '왜', '지금', '일어나다', '생기다']
/** 재난 낱말 — whatsup을 강하게 만든다 */
const DISASTER_WORDS = ['지진', '태풍', '불', '화재', '홍수', '폭발', '사고', '위험', '대피']
/** 방법을 묻는 신호 */
const HOWTO_WORDS = ['방법', '하다', '행동']
/** 도움 요청 */
const HELP_WORDS = ['돕다', '구하다', '급하다', '구조']

/** 검사용으로 한데 모은 것 — `scripts/check_intent_words.mjs`가 인식 모델의
 *  클래스와 대조한다. 목록에 모델이 낼 수 없는 낱말이 있으면 그 뜻으로는
 *  **영영 안 알아듣는데 오류도 안 난다.** 모델을 갈아 끼울 때마다 확인한다. */
export const INTENT_WORDS: Record<string, string[]> = {
  ...Object.fromEntries(Object.entries(PLACE_WORDS).map(([k, v]) => [`장소:${k}`, v])),
  '어디 신호': WHERE_WORDS,
  '무슨 일': WHATSUP_WORDS,
  '재난 낱말': DISASTER_WORDS,
  '방법': HOWTO_WORDS,
  '도움': HELP_WORDS,
}

/** 같은 갈래를 가리키는 낱말이 더 있을 때 더해 주는 값.
 *  0.4면 1순위 낱말 둘("지금"+"무엇")이 1.4가 되어 문턱 1.3을 넘고,
 *  하나만으로는 1.0이라 넘지 못한다 — 한 낱말로 단정하지 않기 위한 값이다. */
const EXTRA_WEIGHT = 0.4

/** 순위별 가중치 — 1순위는 그대로, 뒤로 갈수록 절반씩. 5순위까지만 본다. */
const RANK_WEIGHT = [1, 0.5, 0.3, 0.2, 0.15]

/** 낱말 하나가 목록에 있으면 그 위치의 가중치를 돌려준다. */
function hit(cands: string[], words: string[]): number {
  for (let r = 0; r < Math.min(cands.length, RANK_WEIGHT.length); r += 1) {
    if (words.includes(glossLabel(cands[r]))) return RANK_WEIGHT[r]
  }
  return 0
}

/** 총점이 이 값을 넘어야 의도로 인정한다.
 *
 *  넘는 조합 / 못 넘는 조합을 실제 값으로 적어 둔다(scripts/intent_cases.json에서 잰다):
 *    대피(1위) 어디(1위) = 1.0 + 1.0        → 판정
 *    대피(1위)만          = 1.0 + 단독 0.5   → 판정 (아래 주석 참조)
 *    병원(3위) 어디(1위) = 0.3 + 1.0        → 판정 (인식이 흔들려도 건진다)
 *    학교(2위) 어디(2위) = 0.5 + 0.5        → 판정하지 않음 (둘 다 불확실)
 *    대피(2위)만          = 0.5             → 판정하지 않음
 *    어디(1위)만          = 갈래 없음        → 판정하지 않음 */
const THRESHOLD = 1.3

export interface IntentResult {
  intent: Intent
  score: number
  /** 판정 근거 — 화면에 "이렇게 알아들었어요"로 보여준다(투명성) */
  matched: string[]
}

/**
 * @param words 확정된 낱말(글로스 ID) — 인식 순서대로
 * @param alts  낱말별 상위 후보. words와 같은 길이, 각 원소의 0번이 현재 값.
 */
export function detectIntent(words: string[], alts: string[][] = []): IntentResult | null {
  if (words.length === 0) return null
  const cands = words.map((w, i) => {
    const a = alts[i] ?? []
    return a.length > 0 ? a : [w]
  })

  const matched: string[] = []
  const note = (c: string[], w: number, list: string[]) => {
    if (w > 0) {
      const found = c.find((x) => list.includes(glossLabel(x)))
      if (found) matched.push(glossLabel(found))
    }
  }

  // ── 장소 질문 ─────────────────────────────────────────────
  let bestPlace: { kind: PlaceKind; score: number } | null = null
  for (const kind of Object.keys(PLACE_WORDS) as PlaceKind[]) {
    let s = 0
    for (const c of cands) s = Math.max(s, hit(c, PLACE_WORDS[kind]))
    if (s > 0 && (bestPlace === null || s > bestPlace.score)) bestPlace = { kind, score: s }
  }
  let whereScore = 0
  for (const c of cands) whereScore = Math.max(whereScore, hit(c, WHERE_WORDS))

  if (bestPlace) {
    // 장소 낱말만 있어도 (예: "대피") 물어본 것으로 본다.
    // **왜 그래도 되나.** 수어에서 의문은 눈썹·시선 같은 비수지로 표시되는데
    // 우리는 표정 데이터가 없어 그것을 읽지 못한다(문서화된 한계). 그래서
    // "대피"만 왔을 때 질문인지 아닌지 신호가 없다 — 하지만 이 화면에 들어와
    // 카메라 앞에서 "대피"를 한 사람이 묻는 것 말고 무엇을 하겠는가.
    // 대신 **1순위로 확실히 잡혔을 때만** 보너스를 주고, 답하기 전에 화면이
    // "'대피소가 어디예요?'로 알아들었어요"를 먼저 보여 준다 — 틀렸으면
    // 사용자가 그 자리에서 안다.
    const solo = bestPlace.score >= 1 ? 0.5 : 0
    const total = bestPlace.score + whereScore + solo
    if (total >= THRESHOLD) {
      for (const c of cands) {
        note(c, hit(c, PLACE_WORDS[bestPlace.kind]), PLACE_WORDS[bestPlace.kind])
        note(c, hit(c, WHERE_WORDS), WHERE_WORDS)
      }
      // 대피 + 재난 낱말이 함께면 "지금 무슨 일?"이 아니라 대피소 질문이다.
      return { intent: { kind: 'where', place: bestPlace.kind }, score: total, matched }
    }
  }

  // ── 상황 질문 ─────────────────────────────────────────────
  //
  // **낱말이 여러 개면 더 확실하다.** 예전에는 `Math.max`만 써서 "지금"과 "무엇"을
  // 함께 해도 점수가 하나였고, 재난 질문에서 가장 흔한 이 조합이 문턱에 걸렸다
  // (실측: ['지금','무엇'] → 못 알아들음). 같은 갈래를 가리키는 낱말이 더 있으면
  // 조금씩 더한다 — 한 낱말만으로는 여전히 부족하다("지금"만으로는 안 된다).
  const support = (list: string[]) => {
    let best = 0
    let extra = 0
    for (const c of cands) {
      const h = hit(c, list)
      if (h <= 0) continue
      if (h > best) {
        extra += best > 0 ? 1 : 0
        best = h
      } else {
        extra += 1
      }
    }
    return best + EXTRA_WEIGHT * extra
  }

  let whatsup = 0
  let disaster = 0
  whatsup = support(WHATSUP_WORDS)
  disaster = support(DISASTER_WORDS)
  if (whatsup + disaster >= THRESHOLD) {
    for (const c of cands) {
      note(c, hit(c, WHATSUP_WORDS), WHATSUP_WORDS)
      note(c, hit(c, DISASTER_WORDS), DISASTER_WORDS)
    }
    return { intent: { kind: 'whatsup' }, score: whatsup + disaster, matched }
  }

  // ── 방법 질문 ─────────────────────────────────────────────
  const howto = support(HOWTO_WORDS)
  if (howto + Math.max(whatsup, disaster) >= THRESHOLD) {
    for (const c of cands) note(c, hit(c, HOWTO_WORDS), HOWTO_WORDS)
    return { intent: { kind: 'howto' }, score: howto + disaster, matched }
  }

  // ── 도움 요청 ─────────────────────────────────────────────
  const help = support(HELP_WORDS)
  if (help >= 1) {
    for (const c of cands) note(c, hit(c, HELP_WORDS), HELP_WORDS)
    return { intent: { kind: 'help' }, score: help, matched }
  }

  return null
}

/** 의도를 사람 말로 — 화면에 "이렇게 알아들었어요"로 되비쳐 준다.
 *  잘못 알아들었을 때 사용자가 **바로 알아채고 고칠 수 있어야** 한다. */
export function intentKo(i: Intent): string {
  switch (i.kind) {
    case 'where': return {
      shelter: '대피소가 어디예요?',
      hospital: '병원이 어디예요?',
      pharmacy: '약국이 어디예요?',
      police: '경찰서가 어디예요?',
      subway: '지하철역이 어디예요?',
      toilet: '화장실이 어디예요?',
    }[i.place]
    case 'whatsup': return '지금 무슨 일이에요?'
    case 'howto': return '어떻게 해야 해요?'
    case 'help': return '도와주세요'
  }
}

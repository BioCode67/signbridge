// (b) 수어 변환 — **서버 없이 브라우저에서** 도는 사전 기반 번역기.
//
// 세 단계 폴백의 가운데다:
//   KoBartSignAgent (서버 있음) → 최고 품질
//   DictSignAgent   (이 파일)   → 서버 없어도 실데이터 사전으로 번역   ← 정적 배포의 기본
//   RuleSignAgent               → 사전에도 없을 때 조사만 떼는 최후 수단
//
// 사전(`public/data/align.json`)은 AI Hub 16만 문장쌍에서 한국어 낱말과 글로스의
// 공기 빈도를 Dice 계수로 재어 뽑은 것이다(ml/etl/build_align_dict.py). 어순까지
// 배우진 못하지만 어휘 대응("한파→춥다1", "대피→도망1")은 실제 데이터에서 나온 것이라
// 기존 규칙 기반과는 품질이 다르다.
import type { SignAgent, SignConversion } from './types'
import { glossLabel } from './glossLabel'
import { RuleSignAgent } from './signAgent'

/** 조사·어미 근사 제거 — 파이썬 쪽 build_align_dict.py와 **같은 규칙**이어야 한다.
 *  한쪽만 고치면 사전 키가 어긋나 조용히 못 찾는다. */
const PARTICLE_RE =
  /(으로부터|로부터|에서는|에게서|께서는|하시기|하십시오|입니다|습니다|ㅂ니다|하겠습니다|겠습니다|았습니다|었습니다|였습니다|습니까|ㅂ니까|을까요|ㄹ까요|으십시오|십시오|으세요|세요|주세요|네요|지요|까요|어요|아요|여요|드리오니|되오니|하오니|오니|이에요|예요|에요|이야|인가요|인가|인데|이죠|죠|거예요|을게요|군요|잖아요|거든요|더라고요|던데요|으로|에서|에게|에는|까지|부터|이나|라도|처럼|만큼|보다|이며|이고|하고|하는|하여|해서|되어|되는|된다|하라|하세요|해요|이다|이란|라는|했|해|하|은|는|이|가|을|를|와|과|의|도|만|로|에|께|랑|나)$/
const MIN_STEM = 2

/** 번역 제외어 — 한국어 문법·공손 표현으로, 수어에서는 표현하지 않는다.
 *  이런 낱말의 통계 매핑은 실측 감사에서 전부 잡음이었다(바랍니다→조심1 등).
 *  **build_align_dict.py의 STOP_WORDS와 같은 목록이어야 한다.** */
const STOP_WORDS = new Set([
  '바랍니다', '바라며', '바람니다', '주시기', '주십시오', '있습니다', '있는',
  '있으니', '있으면', '없습니다', '않도록', '않기', '됩니다', '되도록',
  '합니다', '하시기', '하도록', '인해', '인한', '위해', '위한', '통해',
  '통하여', '따라', '따른', '대한', '대해', '관련', '관한', '해당',
  '등의', '등을', '등이', '및', '또는', '그리고', '기타', '위하여', '인하여',
  '시까지', '분부터', '시부터', '분까지', '실시',
  // 창구 대화 실측에서 새로 드러난 잡음 — 공손·의뢰 표현
  '주세요', '주시', '드릴까요', '드릴게요', '드립니다', '드려요', '하겠습니다',
  '하시겠어요', '하시겠습니까', '말씀해', '말씀', '여쭤',
  // 재난문자 상투구 — suspect_align.py 상위에서 잡힌 잡음원
  // ('입니다 → mm', '것으로 → 오래', '등은 → 캠프', '내에서 → 금호동')
  '입니다', '것으로', '것으로는', '등은', '등에', '등에서', '내에서', '기하여',
  '하기로', '되기로', '함에', '됨에', '이라고', '라고',
  '등으로', '등과', '이내', '도가량', '가량',
  '있으며', '예정이니', '완료되었으며', '기하시기', '되었으며', '하시어',
  '없이', '않고', '때에는', '기해주시기', '함으로', '됨으로',
  // 시각·날짜를 전용 동작으로 내면서 남는 조사들. 범위는 물결표로 표시하므로
  // 이 말들 자체는 수어로 옮기지 않는다("21시부터" → 밤 시:9시).
  '부터', '까지', '부로', '이후', '이전',
])

/** 미매칭 보고(낱말 카드)에서 뺄 기능어·상투구 — 정보가 없어 카드로 띄우면 소음이다.
 *  번역 자체에는 영향이 없다(원래도 매칭 안 되던 말들). */
const REPORT_SKIP = new Set([
  '있어', '있다', '있는', '있으니', '없다', '없는', '위해', '통해', '따라', '대한',
  '관련', '해당', '인한', '인해', '바랍니다', '바람', '부탁', '협조', '주시기',
  '주세요', '합니다', '하지', '되지', '아니', '그리고', '또는', '및', '등의', '등을',
])

export function stemKorean(word: string): string {
  let out = word
  let prev = ''
  while (out !== prev) {
    prev = out
    const stripped = out.replace(PARTICLE_RE, '')
    if (stripped.length >= MIN_STEM) out = stripped
  }
  return out.length >= MIN_STEM ? out : word
}

/** 조사를 한 겹씩 벗겨 가며 나오는 형태들 — 원형부터 끝까지.
 *
 *  **끝까지 벗긴 것만 보면 안 된다.** `엑스레이를`은 `를`을 떼면 `엑스레이`(사전에
 *  있다)인데, 한 번 더 돌면 `이`까지 떼어 `엑스레`가 된다. 그 상태로만 찾으니
 *  동작이 사전에 **있는데도** 못 찾았다(실측: "엑스레이를 찍어야 합니다" →
 *  엑스레이가 빠짐). `장애인이 → 장애`처럼 뜻이 바뀌는 자리도 같은 이유다.
 *
 *  그래서 벗긴 순서대로 다 만들어 두고, 사전에 **처음 걸리는 것**을 쓴다. */
export function stemChain(word: string): string[] {
  const forms = [word]
  let out = word
  let prev = ''
  while (out !== prev) {
    prev = out
    const stripped = out.replace(PARTICLE_RE, '')
    if (stripped.length >= MIN_STEM && stripped !== out) {
      out = stripped
      forms.push(out)
    }
  }
  return forms
}

export type AlignTable = Record<string, string[]>

/** 시각·날짜·소요시간 전용 글로스 표 (`public/data/timegloss.json`).
 *  키는 `시:분` / `월-일` 꼴, 값은 동작 사전의 글로스 이름이다. */
export interface TimeGlossTable {
  time: Record<string, string>
  date: Record<string, string>
  dur: Record<string, string>
}

/** 시각 앞에 붙는 시간대 표지 — **말뭉치에서 재어 정한 것이다.**
 *
 * 사람 번역가는 시각 글로스 앞에 거의 언제나 시간대를 붙인다(실측: 아침 6,120회 ·
 * 새벽 4,259 · 밤 3,331 · 저녁 2,865 · 오후 2,310 · 낮 1,449). 그럴 이유가 있다 —
 * 수어 시각은 12시간제라 `시:9시`만으로는 **오전 9시인지 21시인지 알 수 없다.**
 * 표지가 그 모호함을 없앤다.
 *
 * 원문 시각별로 어떤 표지가 붙었는지 26,000여 건에서 재어 아래를 정했다.
 * (0시 밤 70% · 2시 새벽 92% · 8시 아침 94% · 12시 낮 92% · 21시 밤 96% · 23시 밤 100%)
 * 13·14·17시는 두 표지가 팽팽해(오후/낮, 저녁/오후) 순서가 자연스러운 쪽을 골랐다. */
/** 요일 — 날짜 뒤에 붙인다. 동작 사전에 실존하는 이름이어야 한다. */
const WEEKDAY: Record<string, string> = {
  월: '월요일1', 화: '화요일1', 수: '수요일1', 목: '목요일1',
  금: '금요일0', 토: '토요일1', 일: '일요일0',
}

const DAYPART: readonly string[] = [
  '밤1', '새벽1', '새벽1', '새벽1', '새벽1', '새벽1', '새벽1',   // 0-6
  '아침1', '아침1', '아침1', '아침1', '아침1',                  // 7-11
  '낮1', '낮1', '낮1',                                        // 12-14
  '오후1', '오후1', '오후1',                                   // 15-17
  '저녁1', '저녁1', '저녁1',                                   // 18-20
  '밤1', '밤1', '밤1', '밤1',                                  // 21-24
]

// ── 숫자 → 수어 글로스열 ─────────────────────────────────────────────
// 재난문자의 숫자(규모 4.0, 3일, 전화번호)는 한글 토큰화에서 통째로 사라졌다.
// 동작 사전에 숫자 수어(공~구·십·백·천·만·점)가 있으므로 한국식 수 읽기로 변환한다.
//   342   → 삼 백 사 십 이       4.0 → 사 점 영
//   032-… → 공 삼 이 …(자릿수 읽기 — 전화번호는 자리값으로 읽지 않는다)
const DIGIT_GLOSS = ['영', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구']
const PLACE_GLOSS = ['', '십', '백', '천', '만']

export function numberGlosses(num: string): string[] {
  const out: string[] = []
  const digitwise = (s: string) => {
    for (const ch of s) out.push(ch === '0' ? '공' : DIGIT_GLOSS[Number(ch)])
  }
  const [int, frac] = num.split('.')
  // 0으로 시작하거나 다섯 자리 초과(전화번호·우편번호류)는 자릿수 읽기.
  if (/^0/.test(int) || int.length > 5) {
    digitwise(int)
  } else {
    for (let i = 0; i < int.length; i++) {
      const d = Number(int[i])
      const place = int.length - 1 - i
      if (d === 0) continue
      // 십·백·천은 1을 생략해 읽는다(일십 → 십). 만 단위는 일만처럼 읽지만 단순화.
      if (!(d === 1 && place >= 1 && place <= 3)) out.push(DIGIT_GLOSS[d])
      if (place >= 1) out.push(PLACE_GLOSS[place])
    }
    if (out.length === 0) out.push('영')
  }
  if (frac !== undefined) {
    out.push('점')
    for (const ch of frac) out.push(ch === '0' ? '영' : DIGIT_GLOSS[Number(ch)])
  }
  return out
}

// ── 한글 수사 → 숫자 ─────────────────────────────────────────────────
// **왜 필요한가.** 재난문자는 숫자를 아라비아 숫자로 쓰지만, 창구에서 **말로** 들어오는
// 문장은 한글이다 — 음성 인식이 "만 오천 원", "삼십 분", "아홉 시"로 받아 적는다.
// 숫자로 적힌 것만 읽으면 금액·시각이 통째로 사라진다(실측: 진료비·요금 문장 전부 실패).
const SINO_DIGIT: Record<string, number> = {
  영: 0, 공: 0, 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 륙: 6, 칠: 7, 팔: 8, 구: 9,
}
const SINO_PLACE: Record<string, number> = { 십: 10, 백: 100, 천: 1000, 만: 10000 }
// 고유어 수사 — 시각·개수에 쓴다(세 시, 두 명). 관형형(한·두·세·네)도 함께.
const NATIVE_NUM: Record<string, number> = {
  하나: 1, 한: 1, 둘: 2, 두: 2, 셋: 3, 세: 3, 넷: 4, 네: 4, 다섯: 5, 여섯: 6,
  일곱: 7, 여덟: 8, 아홉: 9, 열: 10, 스물: 20, 스무: 20, 서른: 30, 마흔: 40,
  쉰: 50, 예순: 60, 일흔: 70, 여든: 80, 아흔: 90,
}

/** 한글 수사 한 덩어리를 숫자로. 수사가 아니면 null. */
export function readKoreanNumber(token: string): number | null {
  if (token in NATIVE_NUM) return NATIVE_NUM[token]
  // 열하나·스물셋처럼 십 단위 + 낱개
  for (const tens of ['아흔', '여든', '일흔', '예순', '쉰', '마흔', '서른', '스물', '열']) {
    if (token.startsWith(tens) && token.length > tens.length) {
      const rest = NATIVE_NUM[token.slice(tens.length)]
      if (rest !== undefined && rest < 10) return NATIVE_NUM[tens] + rest
    }
  }
  // 한자어 수사 — 삼십사, 오천, 만 …
  let total = 0
  let chunk = 0
  let seen = false
  for (const ch of token) {
    if (ch in SINO_DIGIT) {
      chunk = chunk * 10 + SINO_DIGIT[ch]
      seen = true
    } else if (ch in SINO_PLACE) {
      const place = SINO_PLACE[ch]
      if (place === 10000) {
        total = (total + (chunk || 1)) * 10000
        chunk = 0
      } else {
        total += (chunk || 1) * place
        chunk = 0
      }
      seen = true
    } else {
      return null // 수사가 아닌 글자가 섞였다
    }
  }
  return seen ? total + chunk : null
}

// 숫자 바로 뒤의 한 글자 단위 — 그 자체가 수어 글로스로 있는 것만.
// ('일'은 숫자 1과 같은 표기라 날짜 "3일"도 자연스럽게 "삼 일"이 된다.)
const UNIT_GLOSS: Record<string, string> = {
  시: '시', 분: '분', 도: '도', 명: '명', 층: '층0', 일: '일', 년: '년',
  원: '원', 개: '개', 번: '번', 월: '월', 주: '주',
}

export class DictSignAgent implements SignAgent {
  private table: AlignTable | null = null
  /** 글로스별 문장 내 평균 위치(0=앞, 1=끝). 없으면 어순을 건드리지 않는다. */
  private order: Record<string, number> | null = null
  /** 시각·날짜 전용 글로스 표. 없으면 예전처럼 숫자를 자릿수로 읽는다. */
  private timeGloss: TimeGlossTable | null = null
  private loading: Promise<void> | null = null
  private fallback = new RuleSignAgent()
  /** 직전 변환이 사전으로 됐는지 — UI 표시용. */
  lastBackend: 'dict' | 'rule' = 'rule'

  // erasableSyntaxOnly(TS) 때문에 생성자 파라미터 프로퍼티를 쓸 수 없다 — 명시 필드로.
  private url: string

  constructor(url: string = `${import.meta.env.BASE_URL}data/align.json`) {
    this.url = url
  }

  /** 사전을 한 번만 받아 둔다. 실패해도 예외를 던지지 않는다(폴백이 있다). */
  private ensure(): Promise<void> {
    if (this.table) return Promise.resolve()
    if (!this.loading) {
      this.loading = fetch(this.url)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((json: AlignTable) => {
          this.table = json
        })
        .catch(() => {
          this.table = null
        })
        .then(async () => {
          // 어순표는 있으면 좋고 없어도 되는 것 — 실패해도 번역은 계속된다.
          try {
            const res = await fetch(this.url.replace(/align\.json$/, 'order.json'))
            if (res.ok) this.order = (await res.json()) as Record<string, number>
          } catch {
            this.order = null
          }
          // 시각·날짜 표도 마찬가지 — 없으면 자릿수 읽기로 되돌아갈 뿐이다.
          try {
            const res = await fetch(this.url.replace(/align\.json$/, 'timegloss.json'))
            const t = res.ok ? ((await res.json()) as Partial<TimeGlossTable>) : null
            // **모양을 확인하고 받는다.** 표가 아닌 것이 와도(옛 배포본·검사 스텁)
            // 번역이 죽으면 안 된다 — 이 자리에서 죽으면 문장 전체가 안 나간다.
            this.timeGloss = t?.time && t?.date && t?.dur ? (t as TimeGlossTable) : null
          } catch {
            this.timeGloss = null
          }
        })
    }
    return this.loading
  }

  async convert(text: string): Promise<SignConversion> {
    await this.ensure()
    const table = this.table
    if (!table) {
      this.lastBackend = 'rule'
      return this.fallback.convert(text)
    }

    const gloss: string[] = []
    const unmatched: string[] = []
    // 어순을 바꿀 때 **숫자와 단위가 갈라지면 안 된다**("삼 십 분"이 "분 … 삼 십"이 되면
    // 뜻이 사라진다). 그래서 낱말마다 덩어리 번호를 매겨 두고, 덩어리 단위로만 옮긴다.
    const chunkIds: number[] = []
    let nextChunk = 0
    const pushAs = (g: string, chunk: number) => {
      // 같은 글로스가 연달아 나오면 한 번만 — 수어에서 반복은 다른 의미가 된다.
      if (gloss[gloss.length - 1] === g) return
      gloss.push(g)
      chunkIds.push(chunk)
    }
    const push = (g: string) => pushAs(g, nextChunk++)
    /** 숫자 읽기처럼 반드시 붙어 다녀야 하는 글로스들 */
    const pushGroup = (gs: string[]) => {
      const chunk = nextChunk++
      for (const g of gs) pushAs(g, chunk)
    }
    // 조사를 한 겹씩 벗겨 가며 **처음 걸리는 것**을 쓴다(stemChain 주석 참고).
    const lookup = (w: string): string[] | undefined => {
      for (const form of stemChain(w)) {
        const hit = table[form]
        if (hit?.length) return hit
      }
      return undefined
    }

    // 소요시간 | 날짜 | 시각 | 전화번호 | 숫자 | 한글 낱말 — 문장 순서를 지키며 훑는다.
    // 앞뒤를 봐야 하는 판정이 있어(한 글자 수사는 뒤에 단위가 올 때만 수사로 본다)
    // 한 번에 모아 놓고 색인으로 돈다.
    //
    // **시각·날짜를 숫자보다 먼저 잡는다.** 사람 번역가는 "21시"를 `시:9시`,
    // "10.26"을 `날짜:10월26일`이라는 **전용 동작 하나**로 낸다(말뭉치에서 `시:*`가
    // 17,149회, `날짜:*`가 6,640회 — 가장 많이 쓰는 부류다). 자릿수로 읽으면
    // ("이 십 일 시") 형식도 어법도 틀린다.
    //
    // 날짜의 점 표기(`10.26`)는 **요일 괄호가 붙었을 때만** 날짜로 본다.
    // 그러지 않으면 "규모 4.5"가 4월 5일이 된다.
    const SCAN_RE = new RegExp(
      [
        '(\\d{1,2})시간\\s*(?:(\\d{1,2})분)?',                    // 1,2  소요시간
        '(\\d{1,2})월\\s*(\\d{1,2})일',                           // 3,4  날짜(월일)
        '(\\d{1,2})\\.(\\d{1,2})\\s*\\(\\s*([월화수목금토일])\\s*\\)',  // 5,6,7 날짜(요일 괄호)
        '(\\d{1,2}):(\\d{2})',                                   // 8,9  시각(콜론)
        '(?:(오전|오후|아침|저녁|새벽|밤|낮)\\s*)?(\\d{1,2})시\\s*(?:(\\d{1,2})분)?',  // 10,11,12 시각
        '(\\d{2,4}-\\d{3,4}-\\d{4})',                           // 13   전화번호
        '(\\d+(?:\\.\\d+)?)',                                   // 14   숫자
        '([가-힣]+)',                                            // 15   낱말
        '([~∼])',                                                // 16   범위 물결표
      ].join('|'),
      'g',
    )
    const tg = this.timeGloss
    /** 시각 → [시간대 표지, 시각 글로스]. 표가 없거나 조각이 없으면 null. */
    const timeGlosses = (h24: number, min: number, said?: string): string[] | null => {
      if (!tg) return null
      // 수어 시각은 12시간제다 — 21시는 `시:9시`. 그래서 시간대 표지가 필요하다.
      const h12 = h24 > 12 ? h24 - 12 : h24
      const g = tg.time[`${h12}:${min}`] ?? (min === 0 ? undefined : tg.time[`${h12}:0`])
      if (!g) return null
      // 원문이 "오후 3시"처럼 시간대를 이미 말했으면 그 말을 그대로 쓴다.
      const spoken: Record<string, string> = {
        오전: '오전1', 오후: '오후1', 아침: '아침1', 저녁: '저녁1',
        새벽: '새벽1', 밤: '밤1', 낮: '낮1',
      }
      const mark = (said && spoken[said]) || DAYPART[Math.min(24, Math.max(0, h24))]
      return mark ? [mark, g] : [g]
    }
    const matches = [...text.matchAll(SCAN_RE)]
    let afterNumber = false
    // 한글 수사가 이어지면 합쳐 읽는다: "만" + "오천" → 15000
    let pending: number | null = null
    const flushNumber = () => {
      if (pending === null) return
      pushGroup(numberGlosses(String(pending)))
      pending = null
      afterNumber = true
    }
    for (let mi = 0; mi < matches.length; mi++) {
      const m = matches[mi]

      // ── 시각·날짜·소요시간 — 전용 동작 하나로 낸다 ──────────────
      const dedicated = (): boolean => {
        if (!tg) return false
        if (m[1]) {                                   // "2시간 30분"
          const g = tg.dur[`${+m[1]}:${+(m[2] ?? 0)}`] ?? tg.dur[`${+m[1]}:0`]
          if (g) { pushGroup([g]); return true }
        }
        if (m[3]) {                                   // "10월 26일"
          const g = tg.date[`${+m[3]}-${+m[4]}`]
          if (g) { pushGroup([g]); return true }
        }
        if (m[5]) {                                   // "10.26(화)"
          const g = tg.date[`${+m[5]}-${+m[6]}`]
          // 요일도 함께 낸다 — 사람 번역가가 그렇게 한다(`날짜:1월7일 목요일1 …`).
          // 재난문자의 날짜는 "언제까지"가 핵심이라 요일이 정보의 일부다.
          const wd = m[7] ? WEEKDAY[m[7]] : undefined
          if (g) { pushGroup(wd ? [g, wd] : [g]); return true }
        }
        if (m[8]) {                                   // "15:30"
          const gs = timeGlosses(+m[8], +m[9])
          if (gs) { pushGroup(gs); return true }
        }
        if (m[11]) {                                  // "오후 3시 20분"
          const gs = timeGlosses(+m[11], +(m[12] ?? 0), m[10])
          if (gs) { pushGroup(gs); return true }
        }
        return false
      }
      if (m[1] || m[3] || m[5] || m[8] || m[11]) {
        flushNumber()
        if (dedicated()) { afterNumber = false; continue }
        // 표에 없는 값이면 예전처럼 숫자 + 단위로 읽는다 — 빈손으로 두지 않는다.
        const digits = m[1] ?? m[3] ?? m[5] ?? m[8] ?? m[11]
        const tail = m[2] ?? m[4] ?? m[6] ?? m[9] ?? m[12]
        const unit = m[1] ? '시간' : (m[3] || m[5]) ? '월' : '시'
        pushGroup([...numberGlosses(digits), ...(UNIT_GLOSS[unit[0]] ? [UNIT_GLOSS[unit[0]]] : [])])
        if (tail) pushGroup(numberGlosses(tail))
        afterNumber = false
        continue
      }

      // 범위 표시 — "11:00~15:30", "10.26~10.28". 사람 번역가도 `물결표1`을 쓴다
      // (말뭉치 282회, 앞 글로스가 시:* 49회 · 날짜:* 45회로 대부분 시각·날짜 범위다).
      if (m[16]) {
        flushNumber()
        // **앞 덩어리에 붙인다.** 물결표는 "여기서부터 저기까지"의 시작을 가리키는
        // 표지라, 어순을 다시 잡을 때 떨어져 나가면 뜻이 사라진다(실측에서
        // "날짜 날짜 물결표"로 맨 뒤에 밀렸다).
        pushAs('물결표1', chunkIds[chunkIds.length - 1] ?? nextChunk++)
        afterNumber = false
        continue
      }

      if (m[15]) {
        const word = m[15]
        const value = readKoreanNumber(word)
        if (value !== null) {
          // 한 글자 수사(일·이·삼·오·만…)는 낱말과 겹친다. 뒤에 단위가 와야 수사로 본다
          // — "만 오천 원"은 수, "만 나이"의 '만'은 수가 아니다.
          const next = matches[mi + 1]?.[15]
          const unitNext = next !== undefined && UNIT_GLOSS[next[0]] !== undefined
          // 뒤에 수사가 또 오면 이어지는 수다("만" + "오천" = 15000).
          const numberNext = next !== undefined && readKoreanNumber(next) !== null
          if (word.length >= 2 || unitNext || numberNext || pending !== null) {
            // 큰 자리 뒤에 작은 자리가 이어지면 더한다(만 → 오천 → 15000)
            pending = pending === null ? value
              : pending > value ? pending + value : pending * value
            continue
          }
        }
      }
      flushNumber()
      if (m[13]) {
        // 전화번호: 자릿수 읽기 (032 → 공 삼 이)
        pushGroup(numberGlosses(m[13].replace(/-/g, '')))
        afterNumber = false
        continue
      }
      if (m[14]) {
        pushGroup(numberGlosses(m[14]))
        afterNumber = true
        continue
      }
      const raw = m[15]
      // 숫자 뒤의 단위(3일·14시·5층)는 한 글자여도 살린다 — 조사가 붙어도("14시에")
      // 단위 글자 + 조사뿐이면 단위로 본다.
      if (afterNumber && UNIT_GLOSS[raw[0]]) {
        const rest = raw.slice(1)
        if (rest === '' || rest.replace(PARTICLE_RE, '') === '') {
          // 단위는 앞의 숫자와 같은 덩어리로 — 어순을 바꿔도 떨어지지 않게.
          pushAs(UNIT_GLOSS[raw[0]], chunkIds[chunkIds.length - 1] ?? nextChunk++)
          afterNumber = false
          continue
        }
      }
      if (raw.length === 1) {
        afterNumber = false
        // 한 글자 낱말도 사전에 있으면 살린다 — 밥·물·손·돈처럼 생활에서 가장 자주
        // 쓰는 말이 하필 한 글자다. 사전에는 사람이 확인한 낱말만 1글자 키로
        // 들어 있어(ONE_CHAR_NOUNS), 지문자 자모가 끌려 나오지 않는다.
        const single = table[raw]
        if (single?.length) push(single[0])
        continue
      }
      afterNumber = false
      // 한 글자 낱말은 원칙적으로 건너뛴다(조사·어미와 구별이 안 된다).
      // 다만 **사전에 그 글자 그대로 있는 것**은 살린다 — `몇`·`뭐`·`왜`처럼
      // 실제로 쓰이는 낱말이 있고, 없으면 "몇 살이에요?"가 통째로 비어 나간다.
      // 사전에 넣을 한 글자는 파이썬 쪽 ONE_CHAR_NOUNS에서 사람이 골라 둔다.
      if (raw.length < MIN_STEM && !table[raw]?.length) continue
      // 문법·공손 표현은 번역하지 않는다(수어에 대응 표현이 없다). 카드에도 안 띄운다.
      if (STOP_WORDS.has(raw) || STOP_WORDS.has(stemKorean(raw))) continue
      const hit = lookup(raw)
      if (hit?.length) { push(hit[0]); continue }
      // 복합어 최장일치 분해 — 재난문자는 "실외활동자제"처럼 낱말을 붙여 쓴다.
      // 어간 제거만으로는 못 쪼개므로, 사전 키로 앞에서부터 가장 길게 잘라 나간다.
      // (예: 실외활동자제 → 실외+활동+자제). 두 조각 이상 해석될 때만 채택한다 —
      // 한 조각짜리 우연 매칭은 오역 위험이 크다.
      if (raw.length >= 4) {
        // 조각은 두 종류: 사전에 있는 낱말(글로스로 번역)과 번역 제외어(소비만 하고
        // 글로스 없음). "대피바랍니다" = 대피(번역) + 바랍니다(제외) → 도망1.
        //
        // **앞에서부터 가장 길게 자르면 안 된다.** "한파주의보가"에서 '한파주의'가
        // 사전에 있으면 그걸 먹고 남은 '보가'를 못 붙여 조각이 하나뿐이 되고, 결국
        // 문장 전체가 번역에서 빠졌다(실측). 그래서 **낱말 전체를 덮는 분해**를 찾는다 —
        // 뒤에서부터 채워 오는 동적 계획법이라 되돌아갈 필요가 없다.
        //
        // 조각을 **점수**로 고른다. 길이의 제곱을 더해 긴 조각을 선호한다 —
        // 사전에는 통계 잡음으로 생긴 짧은 키가 섞여 있어("한파주", "의보가"),
        // 아무 분해나 받으면 "한파주 + 의보가"처럼 갈려 뜻이 사라진다.
        // 제곱합을 쓰면 같은 조각 수라도 [한파(4)+주의보가(16)=20]이
        // [한파주(9)+의보가(9)=18]을 이긴다.
        type Part = { piece: string; stop: boolean }
        type Seg = { parts: Part[]; score: number }
        const best: (Seg | null)[] = new Array(raw.length + 1).fill(null)
        best[raw.length] = { parts: [], score: 0 }
        for (let i = raw.length - 1; i >= 0; i--) {
          for (let len = Math.min(raw.length - i, 6); len >= MIN_STEM; len--) {
            const rest = best[i + len]
            if (!rest) continue
            const piece = raw.slice(i, i + len)
            const stop = STOP_WORDS.has(piece)
            if (!stop && !lookup(piece)?.length) continue
            const score = rest.score + len * len
            if (!best[i] || score > best[i]!.score) {
              best[i] = { parts: [{ piece, stop }, ...rest.parts], score }
            }
          }
        }
        const parts = best[0]?.parts ?? null
        if (parts) {
          const glossed = parts.filter((p) => !p.stop)
          if (parts.length >= 2 && glossed.length >= 1) {
            for (const part of glossed) push(lookup(part.piece)![0])
            continue
          }
          // "주시기바랍니다"처럼 전부 제외어 조각이면 조용히 소비한다(카드 소음 방지).
          if (glossed.length === 0) continue
        }
      }
      // 여기까지 왔으면 이 낱말은 번역에서 빠진다 — 어간형으로 기록해 둔다.
      const stem = stemKorean(raw)
      if (!REPORT_SKIP.has(raw) && !REPORT_SKIP.has(stem) && !unmatched.includes(stem)) {
        unmatched.push(stem)
      }
    }

    flushNumber()

    // ── 수어 어순으로 다시 늘어놓는다 ──────────────────────────────
    // 사전 번역은 한국어 어순 그대로 글로스를 늘어놓는다. 그런데 이 말뭉치에서 잰
    // 실제 어순은 **[언제·어디] → [무슨 일] → [무엇을 하라]** 다(조심 0.84, 부탁 0.87,
    // 대비 0.94 · 지역명 0.15~0.20). 그래서 편향이 뚜렷한 낱말만 제자리로 옮긴다.
    // **안정 정렬**이라 편향이 없는 낱말은 원래 순서를 그대로 지킨다.
    const order = this.order
    if (order && gloss.length >= 3) {
      // 덩어리 단위로 모은다(숫자+단위가 갈라지지 않게).
      const chunks: { glosses: string[]; bias: number; at: number }[] = []
      for (let i = 0; i < gloss.length; i++) {
        const id = chunkIds[i]
        const last = chunks[chunks.length - 1]
        if (last && chunkIds[i - 1] === id) last.glosses.push(gloss[i])
        else chunks.push({ glosses: [gloss[i]], bias: 0.5, at: chunks.length })
      }
      for (const c of chunks) {
        // 덩어리 안에서 편향이 알려진 첫 낱말을 대표값으로 쓴다.
        // 어순표는 **표제어**(번호를 뗀 형태) 기준이다 — 번역기가 '조심'을 내놓는데
        // 표가 '조심1'로 돼 있어 한 번도 맞지 않던 적이 있다.
        const known = c.glosses
          .map((g) => order[glossLabel(g)])
          .find((v) => v !== undefined)
        if (known !== undefined) c.bias = known
      }
      chunks.sort((a, b) => a.bias - b.bias || a.at - b.at)
      const reordered = chunks.flatMap((c) => c.glosses)
      gloss.length = 0
      for (const g of reordered) if (gloss[gloss.length - 1] !== g) gloss.push(g)
    }

    if (gloss.length === 0) {
      // 사전은 멀쩡한데 아는 낱말이 하나도 없는 문장이다. 규칙 폴백은 한국어 낱말을
      // 그대로 "글로스"라고 내놓지만 동작 사전에 그런 조각이 없어 **아바타가 서 있는다** —
      // 화면상 정상처럼 보이는 조용한 실패다(실측: 일상 문장 22종이 이렇게 증발).
      // 표현할 수 없다는 사실을 낱말 카드로 정직하게 보여주는 편이 낫다.
      this.lastBackend = 'dict'
      return { text, gloss: [], unmatched }
    }
    // **같은 낱말이 잇따라 나오면 하나만 남긴다.** 이형 번호가 달라도 같은 낱말이다
    // (`복구0 복구1`·`기차1 기차2`·`연기1 연기`). 위에서 한 번 걸렀지만 그때는
    // 글로스 이름이 똑같은 경우만 잡았다. 이형까지 보면 실측 284문장 중 8문장에서
    // 아바타가 같은 말을 두 번 했다 — "화재 발생 화재 발생"처럼 보인다.
    // 수어에서 반복은 복수·강조를 뜻할 수 있지만, 사전 경로는 반복을 **의도해서**
    // 만들지 않는다. 여기 있는 것은 전부 복합어 분해가 남긴 찌꺼기다.
    const squashed: string[] = []
    for (const g of gloss) {
      const prev = squashed[squashed.length - 1]
      if (prev && glossLabel(prev) === glossLabel(g)) continue
      squashed.push(g)
    }

    this.lastBackend = 'dict'
    return { text, gloss: squashed, unmatched }
  }
}

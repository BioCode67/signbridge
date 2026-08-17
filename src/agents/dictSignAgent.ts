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
import { RuleSignAgent } from './signAgent'

/** 조사·어미 근사 제거 — 파이썬 쪽 build_align_dict.py와 **같은 규칙**이어야 한다.
 *  한쪽만 고치면 사전 키가 어긋나 조용히 못 찾는다. */
const PARTICLE_RE =
  /(으로부터|로부터|에서는|에게서|께서는|하시기|하십시오|입니다|습니다|ㅂ니다|으로|에서|에게|에는|까지|부터|이나|라도|처럼|만큼|보다|이며|이고|하고|하는|하여|해서|되어|되는|된다|하라|하세요|해요|이다|이란|라는|은|는|이|가|을|를|와|과|의|도|만|로|에|께|랑|나)$/
const TOKEN_RE = /[가-힣]+/g
const MIN_STEM = 2

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

export type AlignTable = Record<string, string[]>

export class DictSignAgent implements SignAgent {
  private table: AlignTable | null = null
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
    const push = (g: string) => {
      // 같은 글로스가 연달아 나오면 한 번만 — 수어에서 반복은 다른 의미가 된다.
      if (gloss[gloss.length - 1] !== g) gloss.push(g)
    }
    const lookup = (w: string): string[] | undefined => table[w] ?? table[stemKorean(w)]

    for (const raw of text.match(TOKEN_RE) ?? []) {
      if (raw.length < MIN_STEM) continue
      const hit = lookup(raw)
      if (hit?.length) { push(hit[0]); continue }
      // 복합어 최장일치 분해 — 재난문자는 "실외활동자제"처럼 낱말을 붙여 쓴다.
      // 어간 제거만으로는 못 쪼개므로, 사전 키로 앞에서부터 가장 길게 잘라 나간다.
      // (예: 실외활동자제 → 실외+활동+자제). 두 조각 이상 해석될 때만 채택한다 —
      // 한 조각짜리 우연 매칭은 오역 위험이 크다.
      if (raw.length >= 4) {
        const parts: string[] = []
        let i = 0
        while (i < raw.length) {
          let matched = ''
          for (let len = Math.min(raw.length - i, 6); len >= MIN_STEM; len--) {
            const piece = raw.slice(i, i + len)
            if (lookup(piece)?.length) { matched = piece; break }
          }
          if (!matched) { i += 1; continue }
          parts.push(matched)
          i += matched.length
        }
        if (parts.length >= 2) {
          for (const part of parts) push(lookup(part)![0])
        }
      }
    }

    if (gloss.length === 0) {
      this.lastBackend = 'rule'
      return this.fallback.convert(text)
    }
    this.lastBackend = 'dict'
    return { text, gloss }
  }
}

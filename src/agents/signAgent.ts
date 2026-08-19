// (b) 수어 변환 에이전트.
// 한국어 텍스트/키워드 → KSL 글로스 시퀀스.
// (경량 규칙: 조사·어미 제거 + 동의어 정규화. 문장단위 정밀 번역은 연구 영역이라 로드맵.)
import type { SignAgent, SignConversion } from './types'

// 표제어 정규화(동의어 → 대표 글로스).
const NORMALIZE: Record<string, string> = {
  대피하세요: '대피',
  대피해: '대피',
  이동하세요: '이동',
  이동해: '이동',
  위험합니다: '위험',
  즉시: '지금',
  빨리: '지금',
  도와주세요: '도움',
  구조요청: '구조',
}

// 제거할 조사·불용어(끝음절 기준 간이 처리).
const STOPWORDS = new Set(['그리고', '그러나', '또는', '등', '및', '의', '를', '을', '이', '가', '은', '는'])
const PARTICLE_RE = /(으로|로|에서|에게|까지|부터|이나|나|은|는|이|가|을|를|와|과|의|도|만)$/

function toGloss(token: string): string | null {
  let t = token.trim()
  if (!t || STOPWORDS.has(t)) return null
  if (NORMALIZE[t]) return NORMALIZE[t]
  t = t.replace(PARTICLE_RE, '')
  if (t.length === 0) return null
  return t
}

export class RuleSignAgent implements SignAgent {
  convert(text: string): SignConversion {
    const tokens = text.split(/[\s,·.!?~()[\]]+/).filter(Boolean)
    const gloss: string[] = []
    for (const tok of tokens) {
      const g = toGloss(tok)
      if (g && gloss[gloss.length - 1] !== g) gloss.push(g)
    }
    return { text, gloss }
  }
}

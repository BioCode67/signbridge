// (a) 재난 판단 에이전트.
// 수어 인식 토큰 또는 재난문자 텍스트에서 재난 종류·심각도를 판정한다.
// (규칙 기반: 데모 안정성 우선. 실서비스는 분류 LLM/규칙 하이브리드로 확장.)
import type { AgentInput, DisasterAgent, DisasterAssessment, DisasterType, Severity } from './types'

// 키워드 → 재난 종류 매핑(부분 포함 매칭).
const TYPE_RULES: { type: DisasterType; keys: string[] }[] = [
  { type: '지진', keys: ['지진', '흔들림', '무너짐', '진도', '규모'] },
  { type: '태풍', keys: ['태풍', '강풍', '바람'] },
  { type: '호우', keys: ['호우', '비', '폭우'] },
  { type: '침수', keys: ['침수', '홍수', '범람', '물'] },
  { type: '산불', keys: ['산불', '산림'] },
  { type: '화재', keys: ['화재', '불', '연기', '폭발'] },
  { type: '정전', keys: ['정전', '전기', '단전'] },
  { type: '한파', keys: ['한파', '대설', '눈', '결빙'] },
  { type: '폭염', keys: ['폭염', '더위'] },
  { type: '미세먼지', keys: ['미세먼지', '황사', '먼지'] },
  { type: '해일', keys: ['해일', '쓰나미', '눈사태'] },
]

// 심각도 신호어.
const SEVERITY_RULES: { severity: Severity; keys: string[] }[] = [
  { severity: 'emergency', keys: ['긴급', '즉시', '대피', '위험', '구조', '부상'] },
  { severity: 'warning', keys: ['경보', '주의보다', '경계'] },
  { severity: 'watch', keys: ['주의', '유의', '가능'] },
]

function scoreType(tokens: string[]): { type: DisasterType; hits: string[]; score: number } {
  let best: DisasterType = '기타'
  let bestHits: string[] = []
  let bestScore = 0
  for (const rule of TYPE_RULES) {
    const hits = tokens.filter((t) => rule.keys.some((k) => t.includes(k) || k.includes(t)))
    if (hits.length > bestScore) {
      bestScore = hits.length
      best = rule.type
      bestHits = hits
    }
  }
  return { type: best, hits: bestHits, score: bestScore }
}

function scoreSeverity(tokens: string[]): Severity {
  for (const rule of SEVERITY_RULES) {
    if (tokens.some((t) => rule.keys.some((k) => t.includes(k)))) return rule.severity
  }
  return 'info'
}

export class RuleDisasterAgent implements DisasterAgent {
  assess(input: AgentInput): DisasterAssessment {
    const tokens = [
      ...(input.tokens ?? []),
      ...(input.text ? input.text.split(/[\s,·.]+/).filter(Boolean) : []),
    ]
    const { type, hits, score } = scoreType(tokens)
    const severity = scoreSeverity(tokens)
    // 신뢰도 — **눈금을 뜻에 맞춘다.**
    //
    // 예전에는 `score / 3`이라 키워드 셋이 맞아야 100%였다. 그래서
    // "호우경보 발효. 하천변 저지대 침수 위험."처럼 누가 봐도 호우인 문장이
    // `호우경보` 하나만 걸려 **33%**로 표시됐다. 화면에 그 숫자가 뜨면
    // 시스템이 헷갈리고 있다는 뜻으로 읽힌다 — 실제로는 확실한데.
    //
    // 재난문자는 갈래를 가리키는 낱말이 보통 한둘이다. 정확히 맞는 낱말
    // 하나는 약한 근거가 아니다. 다만 하나도 못 맞히면(기타) 낮게 둔다.
    const confidence = score >= 3 ? 0.95 : score === 2 ? 0.85 : score === 1 ? 0.7 : 0.2
    const region = input.geo?.region ? ` (${input.geo.region})` : ''
    const summary =
      type === '기타'
        ? `재난 종류를 특정하지 못했습니다. 인식 키워드: ${tokens.slice(0, 5).join(', ') || '없음'}`
        : `${type} ${sevLabel(severity)} 상황으로 판단${region}. 근거: ${hits.join(', ')}`
    return { type, severity, keywords: hits.length ? hits : tokens.slice(0, 5), confidence, summary }
  }
}

function sevLabel(s: Severity): string {
  return s === 'emergency' ? '긴급' : s === 'warning' ? '경보' : s === 'watch' ? '주의' : '정보'
}

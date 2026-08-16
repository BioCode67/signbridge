// 4-에이전트 파이프라인 공통 타입.
//
// 흐름: 입력(수어 인식 토큰 또는 재난문자) →
//   (a) DisasterAgent  재난 판단 — 종류·심각도·위치
//   (b) SignAgent      수어 변환 — 텍스트/키워드 → KSL 글로스 시퀀스
//   (c) QAAgent        양방향 Q&A — 농인 질문 → 맞춤 응답(언어 백본)
//   (d) BroadcastAgent  송출 제어 — 채널·우선순위·라우팅(KOREN 다지점, 시뮬)
//
// 각 에이전트는 순수 함수적 인터페이스(입력→출력)로, 오케스트레이터가 연결한다.

export type DisasterType =
  | '지진'
  | '태풍'
  | '호우'
  | '침수'
  | '산불'
  | '화재'
  | '정전'
  | '한파'
  | '폭염'
  | '미세먼지'
  | '해일'
  | '기타'

export type Severity = 'info' | 'watch' | 'warning' | 'emergency'

export interface GeoContext {
  region: string // 예: "서울 관악구 신림동"
  lat?: number
  lng?: number
}

/** (a) 재난 판단 결과. */
export interface DisasterAssessment {
  type: DisasterType
  severity: Severity
  /** 인식 토큰/텍스트에서 뽑은 근거 키워드. */
  keywords: string[]
  /** 0~1 판단 신뢰도. */
  confidence: number
  summary: string
}

/** (b) 수어 변환 결과. */
export interface SignConversion {
  text: string
  gloss: string[]
  /** 데모 아바타 재생에 연결 가능한 데이터 파일(있으면). */
  clipId?: string
}

/** (c) Q&A 응답 결과. */
export interface QAResult {
  question: string
  answer: string
  gloss: string[]
  /** 응답을 만든 백본 표기(template | kogpt2 | …). */
  backend: string
}

/** (d) 송출 제어 결과. */
export interface BroadcastPlan {
  channels: string[]
  priority: number // 1(최상)~5
  /** KOREN POP 다지점(시뮬). */
  pops: string[]
  /** 좌표 스트림 추정 대역폭(Mbps). */
  bandwidthMbps: number
  latencyMsTarget: number
}

export interface AgentInput {
  /** 실시간 수어 인식으로 확정된 키워드 토큰(시간순). */
  tokens?: string[]
  /** 또는 재난문자/자막 원문. */
  text?: string
  /** 농인 사용자의 질문(수어 인식 or 텍스트). */
  question?: string
  geo?: GeoContext
}

/** 오케스트레이터 최종 출력. */
export interface PipelineResult {
  assessment: DisasterAssessment
  sign: SignConversion
  qa?: QAResult
  broadcast: BroadcastPlan
  tookMs: number
}

export interface DisasterAgent {
  assess(input: AgentInput): DisasterAssessment
}
export interface SignAgent {
  // 규칙 기반은 동기, KoBART HTTP 백본은 비동기 — 둘 다 허용한다.
  convert(text: string): SignConversion | Promise<SignConversion>
}
export interface QAAgent {
  answer(question: string, ctx: { assessment: DisasterAssessment; geo?: GeoContext }): Promise<QAResult>
}
export interface BroadcastAgent {
  plan(assessment: DisasterAssessment): BroadcastPlan
}

// 4-에이전트 오케스트레이터.
// 입력(수어 인식 토큰 또는 재난문자, 선택적 질문) → 판단 → 변환 → (질문 시)Q&A → 송출계획.
import type {
  AgentInput,
  BroadcastAgent,
  DisasterAgent,
  PipelineResult,
  QAAgent,
  SignAgent,
} from './types'
import { RuleDisasterAgent } from './disasterAgent'
import { KoBartSignAgent } from './kobartSignAgent'
import { LlmQAAgent } from './qaAgent'
import { SimBroadcastAgent } from './broadcastAgent'

export interface Agents {
  disaster: DisasterAgent
  sign: SignAgent
  qa: QAAgent
  broadcast: BroadcastAgent
}

export function defaultAgents(): Agents {
  return {
    disaster: new RuleDisasterAgent(),
    // 학습 모델(KoBART /t2g) 우선, 서버가 없으면 내부적으로 규칙 기반 폴백.
    sign: new KoBartSignAgent(),
    qa: new LlmQAAgent(),
    broadcast: new SimBroadcastAgent(),
  }
}

export class Orchestrator {
  private agents: Agents

  constructor(agents: Agents = defaultAgents()) {
    this.agents = agents
  }

  async run(input: AgentInput): Promise<PipelineResult> {
    const t0 = performance.now()

    // (a) 재난 판단
    const assessment = this.agents.disaster.assess(input)

    // (b) 수어 변환 — 재난문자 원문 또는 인식 토큰을 글로스로
    const sourceText = input.text ?? (input.tokens ?? []).join(' ')
    const sign = await this.agents.sign.convert(sourceText || assessment.summary)

    // (c) 양방향 Q&A — 질문이 있을 때만
    const qa = input.question
      ? await this.agents.qa.answer(input.question, { assessment, geo: input.geo })
      : undefined

    // (d) 송출 제어
    const broadcast = this.agents.broadcast.plan(assessment)

    return { assessment, sign, qa, broadcast, tookMs: Math.round(performance.now() - t0) }
  }
}

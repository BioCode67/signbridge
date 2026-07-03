// (c) Q&A 응답 에이전트.
// 농인 사용자의 질문(수어 인식 or 텍스트) → 언어 백본으로 응답 생성 →
// 응답을 다시 수어 글로스로 변환(SignAgent 재사용)해 양방향 루프를 닫는다.
import type { DisasterAssessment, GeoContext, QAAgent, QAResult } from './types'
import type { LanguageBackbone } from './qaBackbone'
import { TemplateBackbone } from './qaBackbone'
import { RuleSignAgent } from './signAgent'

export class LlmQAAgent implements QAAgent {
  private backbone: LanguageBackbone
  private signAgent = new RuleSignAgent()

  constructor(backbone: LanguageBackbone = new TemplateBackbone()) {
    this.backbone = backbone
  }

  /** 백본 교체(예: KoGPT2 HTTP 백본). 실패 시 폴백을 위해 런타임 교체 허용. */
  setBackbone(b: LanguageBackbone): void {
    this.backbone = b
  }

  async answer(
    question: string,
    ctx: { assessment: DisasterAssessment; geo?: GeoContext },
  ): Promise<QAResult> {
    let answer: string
    let backend = this.backbone.name
    try {
      answer = await this.backbone.generate(question, ctx)
    } catch {
      // 백본(예: KoGPT2 서버) 실패 시 템플릿으로 폴백 — 데모 무중단.
      answer = await new TemplateBackbone().generate(question, ctx)
      backend = 'template(fallback)'
    }
    const gloss = this.signAgent.convert(answer).gloss.slice(0, 8)
    return { question, answer, gloss, backend }
  }
}

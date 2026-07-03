// KoGPT2 HTTP 언어 백본.
// server/app.py(/qa)에 재난 컨텍스트+질문을 보내 생성 응답을 받는다.
// 타임아웃·오류 시 예외를 던져 QAAgent가 템플릿 백본으로 폴백하게 한다.
import type { BackboneContext, LanguageBackbone } from './qaBackbone'

const DEFAULT_URL = 'http://localhost:8000'
const TIMEOUT_MS = 12000

export class KoGPT2Backbone implements LanguageBackbone {
  readonly name = 'kogpt2'
  private url: string

  constructor(url: string = DEFAULT_URL) {
    this.url = url.replace(/\/$/, '')
  }

  async generate(question: string, ctx: BackboneContext): Promise<string> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(`${this.url}/qa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({
          question,
          disaster_type: ctx.assessment.type,
          severity: ctx.assessment.severity,
          region: ctx.geo?.region ?? '',
        }),
      })
      if (!res.ok) throw new Error(`kogpt2 서버 오류 ${res.status}`)
      const data = (await res.json()) as { answer?: string }
      if (!data.answer) throw new Error('빈 응답')
      return data.answer
    } finally {
      clearTimeout(timer)
    }
  }

  /** 서버 헬스체크(UI 표시용). */
  async health(): Promise<boolean> {
    try {
      const res = await fetch(`${this.url}/health`, { method: 'GET' })
      return res.ok
    } catch {
      return false
    }
  }
}

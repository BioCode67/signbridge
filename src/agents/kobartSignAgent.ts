// (b) 수어 변환 에이전트 — KoBART 학습 모델 백본.
// server/app.py(/t2g)에 재난 문장을 보내 학습된 글로스열을 받는다.
// AI Hub 16만 쌍으로 파인튜닝한 모델이라 규칙 기반으로는 못 맞추는
// 어순·조사 생략·수어 특유의 표현(지도1=지역, 서쪽3=서해안 등)을 낸다.
// 서버가 없거나 느리면 기존 RuleSignAgent로 조용히 폴백한다 — 데모가 멈추면 안 된다.
import type { SignAgent, SignConversion } from './types'
import { RuleSignAgent } from './signAgent'

import { API_URL } from '../config'

const DEFAULT_URL = API_URL
const TIMEOUT_MS = 12000

export class KoBartSignAgent implements SignAgent {
  private url: string
  private fallback = new RuleSignAgent()
  /** 직전 호출이 서버였는지 폴백이었는지 — UI 표시용. */
  lastBackend: 'kobart-t2g' | 'rule' = 'rule'

  constructor(url: string = DEFAULT_URL) {
    this.url = url.replace(/\/$/, '')
  }

  async convert(text: string): Promise<SignConversion> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(`${this.url}/t2g`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({ text }),
      })
      if (!res.ok) throw new Error(`t2g 서버 오류 ${res.status}`)
      const data = (await res.json()) as { gloss?: string[] }
      if (!data.gloss || data.gloss.length === 0) throw new Error('빈 글로스')
      this.lastBackend = 'kobart-t2g'
      return { text, gloss: data.gloss }
    } catch {
      this.lastBackend = 'rule'
      return this.fallback.convert(text)
    } finally {
      clearTimeout(timer)
    }
  }
}

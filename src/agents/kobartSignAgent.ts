// (b) 수어 변환 에이전트 — KoBART 학습 모델 백본.
// server/app.py(/t2g)에 재난 문장을 보내 학습된 글로스열을 받는다.
// AI Hub 16만 쌍으로 파인튜닝한 모델이라 규칙 기반으로는 못 맞추는
// 어순·조사 생략·수어 특유의 표현(지도1=지역, 서쪽3=서해안 등)을 낸다.
// 서버가 없거나 느리면 **사전 기반 번역기(DictSignAgent)** 로 조용히 폴백한다.
//
// 예전에는 규칙 기반(RuleSignAgent)으로 바로 떨어졌는데, 그건 조사만 떼는 최후 수단이라
// 한국어 낱말을 그대로 "글로스"라고 내놓는다 — 동작 사전에 그런 조각이 없어 **아바타가
// 가만히 서 있는다.** 문서에는 3단(KoBART → 사전 → 규칙)이라고 적어 두고 코드는 2단이었다.
// 사전 폴백은 그 자체가 규칙 기반을 최후 수단으로 물고 있으므로 3단이 온전히 선다.
import type { SignAgent, SignConversion } from './types'
import { DictSignAgent } from './dictSignAgent'

import { API_URL } from '../config'

const DEFAULT_URL = API_URL
const TIMEOUT_MS = 12000

export class KoBartSignAgent implements SignAgent {
  private url: string
  private fallback = new DictSignAgent()
  /** 직전 호출이 서버였는지 폴백이었는지 — UI 표시용. */
  lastBackend: 'kobart-t2g' | 'dict' | 'rule' = 'rule'

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
      const out = await this.fallback.convert(text)
      // 사전이 실제로 쓰였는지 그대로 전달한다(사전도 실패하면 규칙으로 내려간다).
      this.lastBackend = this.fallback.lastBackend
      return out
    } finally {
      clearTimeout(timer)
    }
  }
}

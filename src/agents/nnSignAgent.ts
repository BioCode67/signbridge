// (b') 수어 변환 — **브라우저에서 도는 학습 모델**.
//
// 세 단계 폴백에서 가장 위다:
//   NnSignAgent   (이 파일)  → 학습된 seq2seq. 어순·생략·대응 없는 글로스까지 만든다
//   DictSignAgent            → 공기빈도 통계 사전 + 규칙
//   RuleSignAgent            → 조사만 떼는 최후 수단
//
// **왜 사전으로는 부족한가.** 사전은 한국어 낱말을 글로스로 바꿔 끼울 뿐이다.
// 그런데 사람 번역가의 글로스열에는 한국어에 대응 낱말이 **없는** 것이 섞인다:
//
//   원문   대설과 한파로 도로가 얼어 미끄러우니, 외출을 자제하시고…
//   사람   눈내리다 온도내려가다 춥다 **자연** 길 얼음 운전 **손 자동차** 미끄럽다 조심 밖 조심 부탁
//
// `자연`(원인 표지)·`손 자동차`(운전 분류사)는 어떤 한국어 낱말과도 짝이 없어
// 사전으로는 영영 못 만든다. 학습 모델은 만든다.
//
// 모델은 재난안전 말뭉치 200,874쌍으로 학습한 소형 트랜스포머다(23.3M, int8 약 23MB).
// KoBART로도 학습해 봤지만 브라우저에 올리기엔 268MB라 과제에 맞춰 작게 다시 지었다.
import type { SignAgent, SignConversion } from './types'
import { DictSignAgent } from './dictSignAgent'

/** 배포 기준 경로. **모듈을 불러올 때가 아니라 쓸 때 읽는다** —
 *  규약 대조 검사는 Node에서 이 파일을 import하는데, 그때는 import.meta.env가 없다.
 *  최상위에서 읽으면 검사 자체가 못 돈다. */
const base = () => (import.meta.env?.BASE_URL ?? './')

interface Meta {
  src: string[]
  tgt: string[]
  pad: number
  bos: number
  eos: number
  max_src: number
  max_tgt: number
}

/** 음절 단위로 쪼갠다 — 학습 때와 **똑같아야 한다**(ml/train_t2g_small.py의 syllables).
 *  토크나이저가 없어 이 한 줄이 곧 규약이다. 공백은 하나로 줄이고 NFC로 합친다. */
function syllables(text: string): string[] {
  return [...text.normalize('NFC').split(/\s+/).filter(Boolean).join(' ')]
}

/** 규약 대조 검사용(scripts/check_syllable_parity.mjs). 앱은 쓰지 않는다. */
export const syllablesForTest = syllables

export class NnSignAgent implements SignAgent {
  private meta: Meta | null = null
  private enc: unknown = null
  private dec: unknown = null
  private ort: typeof import('onnxruntime-web') | null = null
  private loading: Promise<void> | null = null
  private fallback = new DictSignAgent()
  /** 재생 가능한 글로스 — 모델이 못 보여줄 낱말을 고르지 않게 후보를 제한한다. */
  private playable: Set<number> | null = null
  /** 직전 변환이 무엇으로 됐는지 — UI 표시용. */
  lastBackend: 'nn' | 'dict' | 'rule' = 'rule'

  /** 동작 사전에 있는 글로스만 고르게 한다. 사전이 바뀌면 다시 부르면 된다.
   *
   *  **모델보다 먼저 불려도 된다.** 앱은 사전을 읽자마자 이걸 부르는데 그때는
   *  모델이 아직 안 떠 있다. 이름만 받아 두었다가 모델이 뜨면 그때 번호로 바꾼다
   *  (여기서 조용히 무시하면 제한이 걸리지 않아, 못 보여줄 낱말이 그대로 나간다). */
  private wanted: string[] | null = null

  setPlayable(names: Iterable<string>): void {
    this.wanted = [...names]
    this.applyPlayable()
  }

  private applyPlayable(): void {
    if (!this.meta || !this.wanted) return
    const index = new Map(this.meta.tgt.map((g, i) => [g, i]))
    const ids = new Set<number>()
    for (const n of this.wanted) {
      const i = index.get(n)
      if (i !== undefined) ids.add(i)
    }
    // 너무 적게 남으면(사전을 아직 못 읽었다) 제한하지 않는 편이 낫다.
    this.playable = ids.size > 100 ? ids : null
  }

  private ensure(): Promise<void> {
    if (!this.loading) {
      this.loading = (async () => {
        const res = await fetch(`${base()}models/t2g/meta.json`)
        if (!res.ok) throw new Error('t2g meta 없음')
        this.meta = (await res.json()) as Meta
        const ort = await import('onnxruntime-web')
        ort.env.wasm.wasmPaths = new URL(`${base()}ort/`, document.baseURI).href
        ort.env.wasm.numThreads = 1
        this.ort = ort
        const opts = { executionProviders: ['wasm' as const] }
        this.applyPlayable()
        ;[this.enc, this.dec] = await Promise.all([
          ort.InferenceSession.create(`${base()}models/t2g/encoder.onnx`, opts),
          ort.InferenceSession.create(`${base()}models/t2g/decoder.onnx`, opts),
        ])
      })().catch(() => {
        this.meta = null
      })
    }
    return this.loading
  }

  async convert(text: string): Promise<SignConversion> {
    try {
      await this.ensure()
      if (!this.meta || !this.enc || !this.dec || !this.ort) throw new Error('모델 없음')
      const gloss = await this.translate(text)
      if (gloss.length === 0) throw new Error('빈 결과')
      this.lastBackend = 'nn'
      return { text, gloss, unmatched: [] }
    } catch {
      const out = await this.fallback.convert(text)
      this.lastBackend = this.fallback.lastBackend
      return out
    }
  }

  /** 그리디 디코딩. 캐시를 쓰지 않고 매 스텝 앞부분을 다시 계산한다 —
   *  글로스 40개를 넘지 않는 문장이라 이 정도로 충분하고, 그래프가 훨씬 단순하다. */
  private async translate(text: string): Promise<string[]> {
    const meta = this.meta!
    const ort = this.ort as typeof import('onnxruntime-web')
    const enc = this.enc as import('onnxruntime-web').InferenceSession
    const dec = this.dec as import('onnxruntime-web').InferenceSession

    const index = new Map(meta.src.map((s, i) => [s, i]))
    const ids = syllables(text).slice(0, meta.max_src).map((c) => index.get(c) ?? 3 /* <unk> */)
    if (ids.length === 0) return []

    const srcTensor = new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length])
    const encOut = await enc.run({ src: srcTensor })
    const memory = encOut[enc.outputNames[0]]

    const out: number[] = [meta.bos]
    for (let step = 0; step < meta.max_tgt; step += 1) {
      const tgt = new ort.Tensor('int64', BigInt64Array.from(out.map(BigInt)), [1, out.length])
      const res = await dec.run({ memory, tgt })
      const logits = res[dec.outputNames[0]]
      const vocab = meta.tgt.length
      const base = (out.length - 1) * vocab       // 마지막 위치의 로짓만 본다
      const data = logits.data as Float32Array
      let best = -1
      let bestVal = -Infinity
      for (let v = 4; v < vocab; v += 1) {        // 특수 토큰(0~3)은 후보에서 뺀다
        if (this.playable && !this.playable.has(v)) continue
        const val = data[base + v]
        if (val > bestVal) {
          bestVal = val
          best = v
        }
      }
      // EOS는 위 반복에서 제외되므로 따로 견준다 — 문장을 끝낼 줄 알아야 한다.
      if (data[base + meta.eos] > bestVal || best < 0) break
      out.push(best)
    }
    return out.slice(1).map((i) => meta.tgt[i]).filter(Boolean)
  }
}

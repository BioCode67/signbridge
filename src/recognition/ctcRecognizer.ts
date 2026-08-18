// 연속 수어 → **글로스 열**. 낱말 하나가 아니라 문장을 통째로 읽는다 (CTC).
//
// `OnnxRecognizer`(고립 단어)와 나란히 두는 이유는 둘이 하는 일이 다르기 때문이다.
//
// | | 고립 단어 | 연속(이 파일) |
// |---|---|---|
// | 입력 | 고정 64프레임 한 토막 | **길이가 제각각인 전체 구간** |
// | 출력 | 낱말 하나 + 확률 | **글로스 열** |
// | 쓰는 곳 | 낱말을 하나씩 모아 뜻을 고름 | 문장을 그대로 읽음 |
//
// 특징은 **같은 155차원**(landmarks.ts)이다. 이 일치가 깨지면 검증 정확도는 높은데
// 웹캠에서는 아무것도 안 맞는다 — 이 프로젝트에서 가장 찾기 어려운 실패다.
//
// **왜 문장 인식이 필요한가.** 낱말만 읽으면 "대피 어디"처럼 조각으로 도착해서
// 앱이 뜻을 추측해야 한다(askIntent.ts). 문장을 읽으면 추측할 일이 줄어든다.
import * as ort from 'onnxruntime-web/wasm'
import { FEATURE_DIM } from './landmarks'

export interface CtcMeta {
  task: string
  feature_dim: number
  seq_len: number
  num_classes: number
  labels: string[]
  blank_id: number
  /** 앞단 Conv가 시간축을 몇 배로 줄이는가 — 프레임 수를 되짚을 때 쓴다. */
  conv_stride: number
  trained_epoch?: number
  val_wer?: number
}

/** 디코딩 결과 한 조각 — 글로스와, 그것이 나온 출력 프레임 위치. */
export interface CtcToken {
  index: number
  label: string
  /** 출력 프레임 번호(스트라이드 적용 후). 입력 프레임으로 되돌리려면 conv_stride를 곱한다. */
  frame: number
  confidence: number
}

// **모듈 최상위에서 읽지 않는다.** `import.meta.env`는 Vite가 넣어 주는 것이라
// Node에서 이 파일을 그냥 불러오면 undefined다 — 디코딩 대조 검사(ctc_parity)가
// 파일을 직접 import하므로, 최상위에서 읽으면 검사 자체가 못 돈다.
const base = () => import.meta.env?.BASE_URL ?? './'

export class CtcRecognizer {
  private session: ort.InferenceSession | null = null
  private meta: CtcMeta | null = null
  private inputName = 'input'

  get ready(): boolean {
    return this.session !== null
  }
  get info(): CtcMeta | null {
    return this.meta
  }

  async load(
    modelUrl = `${base()}models/ksl-ctc/model.onnx`,
    metaUrl = `${base()}models/ksl-ctc/meta.json`,
    onProgress?: (loadedBytes: number, totalBytes: number) => void,
  ): Promise<void> {
    const metaRes = await fetch(metaUrl)
    if (!metaRes.ok) throw new Error(`모델 정보를 불러오지 못했습니다 (${metaRes.status})`)
    const meta = (await metaRes.json()) as CtcMeta

    // 규격이 어긋나면 여기서 멈춘다. 그냥 돌리면 조용히 엉뚱한 결과가 나온다.
    if (meta.feature_dim !== FEATURE_DIM) {
      throw new Error(`특징 차원 불일치: 모델 ${meta.feature_dim} / 앱 ${FEATURE_DIM}`)
    }
    if (meta.task !== 'ctc') {
      throw new Error(`연속 인식 모델이 아닙니다 (task=${meta.task})`)
    }
    this.meta = meta

    // 경로·스레드 규칙은 OnnxRecognizer와 같아야 한다 — 다르면 한쪽만 조용히 실패한다.
    ort.env.wasm.wasmPaths = new URL(`${base()}ort/`, document.baseURI).href
    ort.env.wasm.numThreads = 1

    const res = await fetch(modelUrl)
    if (!res.ok || !res.body) throw new Error(`모델 다운로드 실패 (${res.status})`)
    const total = Number(res.headers.get('content-length') ?? 0)
    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let loaded = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      loaded += value.length
      onProgress?.(loaded, total)
    }
    const buf = new Uint8Array(loaded)
    let off = 0
    for (const c of chunks) { buf.set(c, off); off += c.length }
    this.session = await ort.InferenceSession.create(buf, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    })
    this.inputName = this.session.inputNames[0]

    // 워밍업. 시간축이 동적이라 실제로 쓸 만한 길이로 한 번 돌려 둔다.
    const frames = Math.max(meta.seq_len, 128)
    const warm = new ort.Tensor('float32', new Float32Array(frames * FEATURE_DIM), [
      1, frames, FEATURE_DIM,
    ])
    await this.session.run({ [this.inputName]: warm })
  }

  /** 프레임열(평탄화 [T*FEATURE_DIM]) → 글로스 열. */
  async decode(seq: Float32Array, frames: number): Promise<CtcToken[]> {
    if (!this.session || !this.meta) return []
    if (frames < 2) return []

    const input = new ort.Tensor('float32', seq, [1, frames, FEATURE_DIM])
    const output = await this.session.run({ [this.inputName]: input })
    const out = output[this.session.outputNames[0]]
    const logits = out.data as Float32Array
    // [1, T', C]
    const steps = out.dims[1] as number
    const classes = out.dims[2] as number

    return greedyDecode(logits, steps, classes, this.meta.blank_id, this.meta.labels)
  }
}

/** CTC 그리디 디코딩 — **같은 글자가 이어지면 하나로 합치고, 공백은 버린다.**
 *
 *  이 두 규칙이 CTC의 전부다. 합치기를 빼면 "대피"가 "대대대피피"가 되고,
 *  공백 버리기를 빼면 글로스 사이마다 빈 칸이 낀다. 둘 다 화면에서는
 *  "인식이 이상하다"로만 보여서 어디가 틀렸는지 알기 어렵다.
 *
 *  **직전 프레임과 같은지**로 판단하지, 결과의 마지막과 비교하지 않는다.
 *  "학교 학교"처럼 같은 낱말이 정말 두 번 나오는 문장이 있고, 그 사이에는
 *  공백 프레임이 낀다 — 결과와 비교하면 그것까지 하나로 합쳐 버린다.
 */
export function greedyDecode(
  logits: Float32Array,
  steps: number,
  classes: number,
  blankId: number,
  labels: string[],
): CtcToken[] {
  const tokens: CtcToken[] = []
  let previous = -1
  for (let t = 0; t < steps; t += 1) {
    const off = t * classes
    let best = 0
    let bestValue = -Infinity
    for (let c = 0; c < classes; c += 1) {
      const v = logits[off + c]
      if (v > bestValue) {
        bestValue = v
        best = c
      }
    }
    if (best !== blankId && best !== previous) {
      // 신뢰도는 그 프레임의 softmax 값. 로짓 그대로는 크기를 비교할 수 없다.
      let sum = 0
      for (let c = 0; c < classes; c += 1) sum += Math.exp(logits[off + c] - bestValue)
      tokens.push({
        index: best,
        label: labels[best] ?? '?',
        frame: t,
        confidence: 1 / sum,
      })
    }
    previous = best
  }
  return tokens
}

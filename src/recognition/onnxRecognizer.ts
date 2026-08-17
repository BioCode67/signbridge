// 실데이터로 학습한 단어 인식 모델을 **브라우저에서** 돌린다 (ONNX Runtime Web).
//
// 기존 `Recognizer`(TF.js)는 합성 데이터로 학습한 것이라 실제 수어를 인식하지 못한다.
// 이 클래스는 AI Hub 16만 클립으로 학습한 트랜스포머(8,147 클래스)를 그대로 쓴다.
// 학습 때와 **같은 155차원 특징**(landmarks.ts)을 입력으로 받는다 — 이 일치가 깨지면
// "검증 정확도는 높은데 웹캠에선 0%"가 된다. 프로젝트에서 가장 찾기 어려운 실패다.
//
// 모델 파일은 20MB라 사용자가 인식 데모를 열 때만 받는다(지연 로드).
// wasm 전용 진입점 — 기본 진입점은 WebGPU 백엔드까지 끌고 와 번들이 크게 불어난다.
import * as ort from 'onnxruntime-web/wasm'
import { FEATURE_DIM, SEQ_LEN } from './landmarks'
import type { Prediction } from './model'

export interface OnnxMeta {
  feature_dim: number
  seq_len: number
  num_classes: number
  labels: string[]
  val_top1?: number
  trained_epoch?: number
}

const BASE = import.meta.env.BASE_URL

export class OnnxRecognizer {
  private session: ort.InferenceSession | null = null
  private meta: OnnxMeta | null = null
  private inputName = 'input'

  get ready(): boolean {
    return this.session !== null
  }
  get labels(): string[] {
    return this.meta?.labels ?? []
  }
  get info(): OnnxMeta | null {
    return this.meta
  }

  async load(
    modelUrl = `${BASE}models/ksl-iso/model.onnx`,
    metaUrl = `${BASE}models/ksl-iso/meta.json`,
  ): Promise<void> {
    const metaRes = await fetch(metaUrl)
    if (!metaRes.ok) throw new Error(`모델 정보를 불러오지 못했습니다 (${metaRes.status})`)
    const meta = (await metaRes.json()) as OnnxMeta

    // 학습·추론 특징이 어긋나면 조용히 엉뚱한 결과가 나온다. 여기서 잡는다.
    if (meta.feature_dim !== FEATURE_DIM || meta.seq_len !== SEQ_LEN) {
      throw new Error(
        `특징 규격 불일치: 모델 ${meta.feature_dim}차원×${meta.seq_len}프레임 / ` +
          `앱 ${FEATURE_DIM}차원×${SEQ_LEN}프레임`,
      )
    }
    this.meta = meta

    // wasm 백엔드로 고정한다. WebGPU가 없는 기기에서도 동작해야 한다(시연 환경은
    // 우리가 고르지 못한다). 스레드는 기기 코어 수에 맞춰 잡는다.
    // wasm 바이너리는 public/ort/에 정적으로 둔다. 번들러가 자동으로 넣어 주지 않아
    // 이 경로를 지정하지 않으면 **실행 시점에** 로드 실패한다(빌드는 통과한다).
    // **문서 기준으로 절대 URL을 만든다.** 상대 경로를 주면 ORT가 자기 모듈 위치
    // (assets/)를 기준으로 잡아 `assets/ort/...`를 찾다가 실행 시점에 실패한다.
    // 빌드는 통과하므로 실제로 돌려 봐야만 드러나는 종류의 오류다.
    ort.env.wasm.wasmPaths = new URL(`${BASE}ort/`, document.baseURI).href
    // 크로스오리진 격리(COOP/COEP)가 없는 정적 호스팅에서는 스레드를 못 쓴다.
    // GitHub Pages가 그렇다 — 1로 두면 어디서든 뜬다.
    ort.env.wasm.numThreads = 1
    this.session = await ort.InferenceSession.create(modelUrl, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    })
    this.inputName = this.session.inputNames[0]

    // 워밍업 — 첫 추론은 수백 ms 걸린다. 데모 중 첫 단어를 놓치지 않게 미리 돌린다.
    const warm = new ort.Tensor('float32', new Float32Array(SEQ_LEN * FEATURE_DIM), [
      1, SEQ_LEN, FEATURE_DIM,
    ])
    await this.session.run({ [this.inputName]: warm })
  }

  /** 평탄화된 [SEQ_LEN*FEATURE_DIM] 시퀀스를 분류한다. */
  async predict(seq: Float32Array): Promise<Prediction | null> {
    if (!this.session || !this.meta) return null
    const input = new ort.Tensor('float32', seq, [1, SEQ_LEN, FEATURE_DIM])
    const output = await this.session.run({ [this.inputName]: input })
    const logits = output[this.session.outputNames[0]].data as Float32Array

    // 모델은 로짓을 낸다 — 신뢰도로 쓰려면 softmax가 필요하다.
    // 최댓값을 빼고 지수화한다(그대로 exp하면 오버플로한다).
    let max = -Infinity
    for (let i = 0; i < logits.length; i++) if (logits[i] > max) max = logits[i]
    const probs = new Float32Array(logits.length)
    let sum = 0
    for (let i = 0; i < logits.length; i++) {
      const e = Math.exp(logits[i] - max)
      probs[i] = e
      sum += e
    }
    let index = 0
    let confidence = 0
    for (let i = 0; i < probs.length; i++) {
      probs[i] /= sum
      if (probs[i] > confidence) {
        confidence = probs[i]
        index = i
      }
    }
    return { index, label: this.meta.labels[index] ?? '?', confidence, probs }
  }
}

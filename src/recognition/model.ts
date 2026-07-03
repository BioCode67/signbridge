// 랜드마크 시퀀스 → 재난 키워드 GRU 분류기.
// 학습(Node 스크립트)과 추론(브라우저)이 같은 아키텍처를 쓰도록 모델 정의를 공유한다.
import * as tf from '@tensorflow/tfjs'
import { FEATURE_DIM, SEQ_LEN } from './landmarks'
import { KSL_LABELS, NUM_CLASSES } from './labels'

/** [SEQ_LEN, FEATURE_DIM] 시퀀스 → NUM_CLASSES 소프트맥스. 2-스택 GRU. */
export function buildModel(): tf.LayersModel {
  const model = tf.sequential()
  model.add(tf.layers.gru({ units: 64, returnSequences: true, inputShape: [SEQ_LEN, FEATURE_DIM] }))
  model.add(tf.layers.gru({ units: 64 }))
  model.add(tf.layers.dropout({ rate: 0.3 }))
  model.add(tf.layers.dense({ units: 64, activation: 'relu' }))
  model.add(tf.layers.dense({ units: NUM_CLASSES, activation: 'softmax' }))
  model.compile({
    optimizer: tf.train.adam(1e-3),
    loss: 'categoricalCrossentropy',
    metrics: ['accuracy'],
  })
  return model
}

export interface Prediction {
  index: number
  label: string
  confidence: number
  probs: Float32Array
}

/** 브라우저 추론용 래퍼. 저장된 모델을 로드해 시퀀스를 분류한다. */
export class Recognizer {
  private model: tf.LayersModel | null = null

  get ready(): boolean {
    return this.model !== null
  }

  async load(url = '/models/ksl-gru/model.json'): Promise<void> {
    this.model = await tf.loadLayersModel(url)
    // 워밍업(첫 추론 지연 제거).
    tf.tidy(() => {
      const warm = tf.zeros([1, SEQ_LEN, FEATURE_DIM])
      ;(this.model!.predict(warm) as tf.Tensor).dataSync()
    })
  }

  /** 평탄화된 [SEQ_LEN*FEATURE_DIM] 시퀀스를 분류. 동기(소형 모델이라 실시간 허용). */
  predict(seq: Float32Array): Prediction | null {
    if (!this.model) return null
    return tf.tidy(() => {
      const x = tf.tensor(seq, [1, SEQ_LEN, FEATURE_DIM])
      const y = this.model!.predict(x) as tf.Tensor
      const probs = y.dataSync() as Float32Array
      let index = 0
      let confidence = probs[0]
      for (let i = 1; i < probs.length; i++) {
        if (probs[i] > confidence) {
          confidence = probs[i]
          index = i
        }
      }
      return { index, label: KSL_LABELS[index], confidence, probs: probs.slice() }
    })
  }

  /** 브라우저에서 학습한 모델을 인식기에 직접 주입(record→train 스튜디오용). */
  setModel(model: tf.LayersModel): void {
    this.model = model
  }

  dispose(): void {
    this.model?.dispose()
    this.model = null
  }
}

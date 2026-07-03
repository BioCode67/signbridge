// GRU 재난 키워드 분류기 — 합성 데이터 학습 스크립트 (Node, 순수 tfjs/CPU).
//
// 목적: 실제 AI Hub 라벨 데이터를 브라우저 학습에 붙이기 전에도, 인식 파이프라인이
// end-to-end로 "학습 → 저장 → 브라우저 로드 → 추론"까지 돈다는 것을 증명하고
// 기본 모델(public/models/ksl-gru/)을 산출한다.
//
// 주의: 합성 데이터는 클래스마다 구별되는 인공 궤적일 뿐, 실제 수어 동작이 아니다.
// 따라서 이 기본 모델은 "파이프라인 실증용"이며, 실제 웹캠 수어의 진짜 인식은
// (a) 브라우저 record→train 스튜디오(자체수집) 또는 (b) 추후 AI Hub 학습으로 대체한다.
//
// 실행: node scripts/train-synth.mjs
import * as tf from '@tensorflow/tfjs'
import { writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, '..', 'public', 'models', 'ksl-gru')

// ── landmarks.ts / labels.ts 와 반드시 일치해야 하는 상수 ─────────────────
const FEATURE_DIM = 155
const SEQ_LEN = 32
const NUM_CLASSES = 30
const SAMPLES_PER_CLASS = 24
const EPOCHS = 15

// 재현성 있는 시드 RNG (mulberry32).
function makeRng(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const gauss = (rng) => {
  // Box-Muller
  const u = Math.max(rng(), 1e-9)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng())
}

// 클래스별 "동작 서명": 기준 자세 b_c + 시간축 진동 방향 d_c(위상/진폭).
// 같은 클래스 샘플은 서명을 공유하고, 위상·진폭·잡음만 달라 클래스가 분리된다.
function classSignature(c) {
  const rng = makeRng(1000 + c * 7919)
  const base = new Float32Array(FEATURE_DIM)
  const dir = new Float32Array(FEATURE_DIM)
  for (let i = 0; i < FEATURE_DIM; i++) {
    base[i] = gauss(rng) * 0.6
    dir[i] = gauss(rng) * 0.5
  }
  const cycles = 1 + Math.floor(rng() * 3) // 1~3 주기
  return { base, dir, cycles }
}

function makeSample(c, sampleSeed) {
  const { base, dir, cycles } = classSignature(c)
  const rng = makeRng(sampleSeed)
  const phase = rng() * Math.PI * 2
  const amp = 0.7 + rng() * 0.6
  const seq = new Float32Array(SEQ_LEN * FEATURE_DIM)
  for (let t = 0; t < SEQ_LEN; t++) {
    const s = Math.sin((cycles * 2 * Math.PI * t) / SEQ_LEN + phase) * amp
    for (let i = 0; i < FEATURE_DIM; i++) {
      seq[t * FEATURE_DIM + i] = base[i] + s * dir[i] + gauss(rng) * 0.08
    }
  }
  return seq
}

// 합성 데이터는 분리도가 높아 단층 GRU로 충분(순수 CPU 학습 속도 확보).
// 브라우저 record→train 스튜디오(model.ts)는 WebGL이라 2-스택을 유지한다.
function buildModel() {
  const model = tf.sequential()
  model.add(tf.layers.gru({ units: 48, inputShape: [SEQ_LEN, FEATURE_DIM] }))
  model.add(tf.layers.dropout({ rate: 0.3 }))
  model.add(tf.layers.dense({ units: 48, activation: 'relu' }))
  model.add(tf.layers.dense({ units: NUM_CLASSES, activation: 'softmax' }))
  model.compile({ optimizer: tf.train.adam(1e-3), loss: 'categoricalCrossentropy', metrics: ['accuracy'] })
  return model
}

// 순수 tfjs(Node)에는 file:// 저장 핸들러가 없으므로 표준 포맷으로 직접 기록.
async function saveModel(model, dir) {
  await mkdir(dir, { recursive: true })
  await model.save(
    tf.io.withSaveHandler(async (artifacts) => {
      const modelJson = {
        modelTopology: artifacts.modelTopology,
        format: artifacts.format,
        generatedBy: artifacts.generatedBy,
        convertedBy: artifacts.convertedBy ?? null,
        weightsManifest: [{ paths: ['weights.bin'], weights: artifacts.weightSpecs }],
      }
      await writeFile(join(dir, 'model.json'), JSON.stringify(modelJson))
      await writeFile(join(dir, 'weights.bin'), Buffer.from(artifacts.weightData))
      return { modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: 'JSON' } }
    }),
  )
}

async function main() {
  console.log(`합성 데이터 생성: ${NUM_CLASSES}클래스 × ${SAMPLES_PER_CLASS}샘플 …`)
  const n = NUM_CLASSES * SAMPLES_PER_CLASS
  // (클래스, 샘플) 인덱스를 만들고 셔플 — validationSplit이 마지막 x%를 떼므로
  // 정렬 상태면 특정 클래스가 통째로 학습에서 빠진다(→ 셔플 필수).
  const order = []
  for (let c = 0; c < NUM_CLASSES; c++) for (let s = 0; s < SAMPLES_PER_CLASS; s++) order.push([c, s])
  const shuf = makeRng(2024)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(shuf() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  const xs = new Float32Array(n * SEQ_LEN * FEATURE_DIM)
  const ys = new Float32Array(n * NUM_CLASSES)
  for (let row = 0; row < order.length; row++) {
    const [c, s] = order[row]
    const seq = makeSample(c, 500000 + c * 1000 + s)
    xs.set(seq, row * SEQ_LEN * FEATURE_DIM)
    ys[row * NUM_CLASSES + c] = 1
  }
  const X = tf.tensor3d(xs, [n, SEQ_LEN, FEATURE_DIM])
  const Y = tf.tensor2d(ys, [n, NUM_CLASSES])

  const model = buildModel()
  model.summary()
  console.log(`학습 시작: ${EPOCHS} epochs …`)
  await model.fit(X, Y, {
    epochs: EPOCHS,
    batchSize: 32,
    validationSplit: 0.15,
    shuffle: true,
    callbacks: {
      onEpochEnd: (epoch, logs) => {
        if ((epoch + 1) % 5 === 0 || epoch === EPOCHS - 1) {
          console.log(
            `  epoch ${epoch + 1}/${EPOCHS}  loss=${logs.loss.toFixed(3)}  acc=${(logs.acc ?? logs.accuracy ?? 0).toFixed(3)}  val_acc=${(logs.val_acc ?? logs.val_accuracy ?? 0).toFixed(3)}`,
          )
        }
      },
    },
  })

  await saveModel(model, OUT_DIR)
  console.log(`\n저장 완료 → ${OUT_DIR}\\{model.json, weights.bin}`)

  // 산출 모델로 즉석 검증 — 전 클래스 새 시드 샘플로 정확도 측정(파이프라인 실증).
  let correct = 0
  for (let c = 0; c < NUM_CLASSES; c++) {
    const seq = makeSample(c, 7000000 + c) // 학습에 안 쓴 시드
    const best = tf.tidy(() => {
      const out = model.predict(tf.tensor3d(seq, [1, SEQ_LEN, FEATURE_DIM]))
      return out.argMax(1).dataSync()[0]
    })
    if (best === c) correct++
  }
  console.log(`검증: 전 ${NUM_CLASSES}클래스 새 샘플 정확도 = ${((correct / NUM_CLASSES) * 100).toFixed(1)}% (${correct}/${NUM_CLASSES})`)

  X.dispose()
  Y.dispose()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

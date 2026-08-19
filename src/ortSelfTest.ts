// ONNX 추론기 자가 진단. `?selftest=onnx`로 접속하면 콘솔에 결과를 찍는다.
//
// 왜 필요한가: wasm 경로·입력 이름·특징 규격 문제는 **빌드에서 안 잡히고 실행 때 터진다.**
// 웹캠 없이도 이 경로를 확인할 수 있어야 배포 전에 안심할 수 있다.
import { OnnxRecognizer } from './recognition/onnxRecognizer'
import { FEATURE_DIM, SEQ_LEN } from './recognition/landmarks'

export async function runOnnxSelfTest(): Promise<void> {
  const log = (...a: unknown[]) => console.log('[onnx-selftest]', ...a)
  try {
    const rec = new OnnxRecognizer()
    const t0 = performance.now()
    await rec.load()
    const t1 = performance.now()
    log('세션 로드', Math.round(t1 - t0), 'ms · 클래스', rec.info?.num_classes)

    const seq = new Float32Array(SEQ_LEN * FEATURE_DIM)
    for (let i = 0; i < seq.length; i++) seq[i] = Math.sin(i * 0.017) * 0.4
    const t2 = performance.now()
    const pred = await rec.predict(seq)
    const t3 = performance.now()
    log('추론', Math.round(t3 - t2), 'ms → ', pred?.label, (pred?.confidence ?? 0).toFixed(4))

    const sum = pred ? pred.probs.reduce((s, v) => s + v, 0) : 0
    log('확률 합계(1이어야 정상):', sum.toFixed(4))
    log(sum > 0.99 && sum < 1.01 ? '✅ 통과' : '❌ softmax 이상')
  } catch (err) {
    console.error('[onnx-selftest] ❌ 실패:', err)
  }
}

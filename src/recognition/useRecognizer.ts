// 실시간 시퀀스 인식 오케스트레이션 훅.
// - 특징 프레임을 링버퍼에 누적(pushFrame)
// - 일정 주기로 최근 윈도우를 리샘플 → GRU 추론 → 현재 키워드/신뢰도 갱신
// - 신뢰도·안정성 조건을 만족하면 자막 토큰으로 확정(debounce)
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Recognizer, type Prediction } from './model'
import { KSL_LABELS } from './labels'
import { OnnxRecognizer } from './onnxRecognizer'
import { resampleSequence, SEQ_LEN, FEATURE_DIM } from './landmarks'
import { CONFIDENCE_THRESHOLD } from './labels'

const BUFFER_CAP = 48 // 최근 프레임 최대 보관 수
const INFER_MS = 250 // 추론 주기
const MIN_FRAMES = 12 // 최소 누적 프레임(이보다 적으면 추론 보류)

/** 손이 보인 프레임 비율이 이 값보다 낮으면 **추론하지 않는다.**
 *
 *  특징 벡터의 마지막 두 값은 손 존재 플래그다. 손이 하나도 안 잡히면 벡터가
 *  프레임마다 **거의 똑같아져서**, 모델은 그 벡터에 맞는 클래스 하나를 매번
 *  자신 있게 낸다. 실측에서 카메라에 얼굴만 들어온 판에서 무슨 동작을 하든
 *  `지시`만 나왔다 — 사용자는 "인식이 안 된다"가 아니라 "엉뚱하게 알아듣는다"로
 *  느낀다. 손이 없으면 **답을 내지 않는 편이 옳다.** */
const HAND_MIN_RATIO = 0.25
const STABLE_HITS = 2 // 같은 라벨이 연속 N회면 자막 확정

export type ModelStatus = 'idle' | 'loading' | 'ready' | 'custom' | 'error'

/** 어느 모델로 인식할지.
 *  - 'synth' : 합성 데이터로 학습한 TF.js GRU. 스튜디오(녹화→학습)가 쓰는 경로다.
 *  - 'aihub' : AI Hub 16만 클립으로 학습한 트랜스포머(ONNX). 실제 수어를 인식한다. */
export type Backend = 'synth' | 'aihub'

export interface UseRecognizerResult {
  modelStatus: ModelStatus
  current: Prediction | null
  transcript: string[]
  /** transcript와 같은 길이 — 낱말별 상위 후보(1위가 현재 값) */
  transcriptAlts: string[][]
  /** i번째 낱말을 후보 중 하나로 바꾼다 */
  replaceWord(index: number, label: string): void
  clearTranscript: () => void
  /** 손이 화면에 잡히고 있는가(false면 추론을 멈춘 상태) */
  handsSeen: boolean
  pushFrame: (features: Float32Array | null) => void
  /** 링버퍼에서 최근 윈도우를 리샘플해 반환(스튜디오 녹화 캡처용). */
  captureWindow: () => Float32Array | null
  recognizer: React.RefObject<Recognizer>
  setStatus: (s: ModelStatus) => void
  reloadDefault: () => void
  backend: Backend
  setBackend: (b: Backend) => void
  /** 실데이터 모델 정보(클래스 수·검증 정확도) — UI에 정직하게 표시하기 위한 것 */
  aihubInfo: { num_classes: number; val_top1?: number } | null
  /** 실데이터 모델 다운로드 진행률(0~100), 미로드 시 null */
  loadPct: number | null
  /** 현재 프레임의 상위 후보 3개 — "AI가 무엇과 헷갈리는지" 투명하게 보여준다. */
  top3: { label: string; confidence: number }[]
}

/** 확률 배열에서 상위 k개를 뽑는다. */
function topK(
  probs: ArrayLike<number>,
  labels: readonly string[],
  k: number,
): { label: string; confidence: number }[] {
  const picks: { label: string; confidence: number }[] = []
  const taken = new Set<number>()
  for (let n = 0; n < k; n++) {
    let best = -1
    let bestP = 0
    for (let i = 0; i < probs.length; i++) {
      if (!taken.has(i) && probs[i] > bestP) { bestP = probs[i]; best = i }
    }
    if (best < 0) break
    taken.add(best)
    picks.push({ label: labels[best] ?? '?', confidence: bestP })
  }
  return picks
}

export function useRecognizer(enabled: boolean): UseRecognizerResult {
  const recognizerRef = useRef<Recognizer>(new Recognizer())
  const onnxRef = useRef<OnnxRecognizer>(new OnnxRecognizer())
  const bufRef = useRef<Float32Array[]>([])
  const [backend, setBackendState] = useState<Backend>('aihub')
  const [aihubInfo, setAihubInfo] = useState<{ num_classes: number; val_top1?: number } | null>(null)
  // 실데이터 모델(20MB) 다운로드 진행률(0~100). 로드 중이 아닐 땐 null.
  const [loadPct, setLoadPct] = useState<number | null>(null)
  // ONNX 추론은 비동기다. 이전 추론이 끝나기 전에 또 넣으면 큐가 밀려 지연이 쌓인다.
  const inFlightRef = useRef(false)
  const [modelStatus, setModelStatus] = useState<ModelStatus>('idle')
  /** 손이 화면에 잡히고 있는가 — 화면이 "손을 보여 주세요"라고 안내할 근거 */
  const [handsSeen, setHandsSeen] = useState(true)
  const [current, setCurrent] = useState<Prediction | null>(null)
  const [transcript, setTranscript] = useState<string[]>([])
  /** 확정된 낱말마다의 상위 후보 — 사용자가 골라 고칠 수 있게. */
  const [transcriptAlts, setTranscriptAlts] = useState<string[][]>([])

  // 자막 확정용 debounce 상태.
  const pendingRef = useRef<{ label: string; hits: number }>({ label: '', hits: 0 })
  const lastCommittedRef = useRef<string>('')

  const pushFrame = useCallback((features: Float32Array | null) => {
    if (!features) return
    const buf = bufRef.current
    buf.push(features)
    if (buf.length > BUFFER_CAP) buf.shift()
  }, [])

  const captureWindow = useCallback((): Float32Array | null => {
    const buf = bufRef.current
    if (buf.length < MIN_FRAMES) return null
    return resampleSequence(buf, SEQ_LEN)
  }, [])

  const clearTranscript = useCallback(() => {
    setTranscript([])
    setTranscriptAlts([])
    lastCommittedRef.current = ''
  }, [])

  /** 확정된 낱말을 후보 중 하나로 바꾼다 — 인식이 틀렸을 때 사용자가 고치는 길. */
  const replaceWord = useCallback((index: number, label: string) => {
    setTranscript((t) => t.map((w, i) => (i === index ? label : w)))
  }, [])

  const reloadDefault = useCallback(() => {
    setModelStatus('loading')
    recognizerRef.current
      .load()
      .then(() => setModelStatus('ready'))
      .catch(() => setModelStatus('error'))
  }, [])

  /** 백엔드 전환 — 필요한 모델을 그때 받는다(실데이터 모델은 20MB라 미리 받지 않는다). */
  const setBackend = useCallback((b: Backend) => {
    setBackendState(b)
    setCurrent(null)
    pendingRef.current = { label: '', hits: 0 }
    if (b === 'synth') {
      if (!recognizerRef.current.ready) reloadDefault()
      else setModelStatus('ready')
      return
    }
    if (onnxRef.current.ready) {
      setModelStatus('ready')
      return
    }
    setModelStatus('loading')
    setLoadPct(0)
    onnxRef.current
      .load(undefined, undefined, (l, t) => { if (t) setLoadPct(Math.round((l / t) * 100)) })
      .then(() => {
        setLoadPct(null)
        const info = onnxRef.current.info
        if (info) setAihubInfo({ num_classes: info.num_classes, val_top1: info.val_top1 })
        setModelStatus('ready')
      })
      .catch((err) => {
        console.error('[recognizer] 실데이터 모델 로드 실패', err)
        setLoadPct(null)
        setModelStatus('error')
      })
  }, [reloadDefault])

  // 최초 로드 — 기본은 실데이터 모델이다(합성 모델은 실제 수어를 인식하지 못한다).
  useEffect(() => {
    setBackend('aihub')
  }, [setBackend])

  // 추론 루프.
  useEffect(() => {
    if (!enabled) return
    // 예측 하나를 받아 자막 확정까지 처리한다(두 백엔드가 공유).
    const handle = (pred: Prediction | null) => {
      if (!pred) return
      setCurrent(pred)

      // 자막 확정 로직.
      if (pred.confidence >= CONFIDENCE_THRESHOLD) {
        const p = pendingRef.current
        if (p.label === pred.label) p.hits += 1
        else pendingRef.current = { label: pred.label, hits: 1 }
        if (
          pendingRef.current.hits >= STABLE_HITS &&
          pred.label !== lastCommittedRef.current
        ) {
          lastCommittedRef.current = pred.label
          setTranscript((t) => [...t, pred.label].slice(-24))
          // **후보를 함께 남긴다.** 낱말 하나를 78.6%로 맞히는 모델이라, 틀린 말이
          // 소리로 나가면 창구에서 바로 오해가 된다. 사용자가 후보에서 골라
          // 고칠 수 있게 하면 top-5(90.8%)의 정확도를 손가락 한 번으로 쓰게 된다.
          const labels = backend === 'aihub' ? onnxRef.current.labels : KSL_LABELS
          const alts = pred.probs ? topK(pred.probs, labels, 5).map((c) => c.label) : [pred.label]
          setTranscriptAlts((a) => [...a, alts].slice(-24))
        }
      } else {
        pendingRef.current = { label: '', hits: 0 }
      }
    }

    const id = window.setInterval(() => {
      const buf = bufRef.current
      if (buf.length < MIN_FRAMES) return

      // 손이 보인 프레임 비율 — 특징 벡터 끝 두 칸이 좌·우 손 존재 플래그다.
      let withHand = 0
      for (const f of buf) {
        if (f[FEATURE_DIM - 2] > 0 || f[FEATURE_DIM - 1] > 0) withHand += 1
      }
      const ratio = withHand / buf.length
      setHandsSeen(ratio >= HAND_MIN_RATIO)
      if (ratio < HAND_MIN_RATIO) {
        // 손이 없으면 **추론하지 않는다.** 하면 매번 같은 낱말을 자신 있게 낸다.
        setCurrent(null)
        pendingRef.current = { label: '', hits: 0 }
        return
      }

      const seq = resampleSequence(buf, SEQ_LEN)
      if (seq.length !== SEQ_LEN * FEATURE_DIM) return

      if (backend === 'aihub') {
        const onnx = onnxRef.current
        // 비동기 추론 — 이전 것이 안 끝났으면 이번 주기는 건너뛴다. 큐가 밀리면
        // 화면이 과거 프레임을 따라가게 되어 '실시간'이 아니게 된다.
        if (!onnx.ready || inFlightRef.current) return
        inFlightRef.current = true
        void onnx
          .predict(seq)
          .then(handle)
          .catch(() => undefined)
          .finally(() => { inFlightRef.current = false })
        return
      }

      const rec = recognizerRef.current
      if (!rec.ready) return
      handle(rec.predict(seq))
    }, INFER_MS)
    return () => window.clearInterval(id)
  }, [enabled, backend])

  // 상위 후보 3개 — probs 전체에서 한 번 훑어 뽑는다(8천 클래스여도 밀리초 미만).
  // (topK를 쓰지 않고 여기 그대로 둔 이유: 렌더 중 ref를 읽는 것을 린터가 잡는다.
  //  확정 시점의 후보는 효과 안에서 topK로 뽑으므로 그쪽은 문제가 없다.)
  const top3 = useMemo(() => {
    if (!current?.probs) return []
    const labels = backend === 'aihub' ? onnxRef.current.labels : KSL_LABELS
    const picks: { label: string; confidence: number }[] = []
    const probs = current.probs
    const taken = new Set<number>()
    for (let k = 0; k < 3; k++) {
      let best = -1
      let bestP = 0
      for (let i = 0; i < probs.length; i++) {
        if (!taken.has(i) && probs[i] > bestP) { bestP = probs[i]; best = i }
      }
      if (best < 0) break
      taken.add(best)
      picks.push({ label: labels[best] ?? '?', confidence: bestP })
    }
    return picks
  }, [current, backend])

  return {
    modelStatus,
    handsSeen,
    current,
    transcript,
    transcriptAlts,
    replaceWord,
    clearTranscript,
    pushFrame,
    captureWindow,
    recognizer: recognizerRef,
    setStatus: setModelStatus,
    reloadDefault,
    backend,
    setBackend,
    aihubInfo,
    loadPct,
    top3,
  }
}

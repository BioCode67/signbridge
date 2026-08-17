// 실시간 시퀀스 인식 오케스트레이션 훅.
// - 특징 프레임을 링버퍼에 누적(pushFrame)
// - 일정 주기로 최근 윈도우를 리샘플 → GRU 추론 → 현재 키워드/신뢰도 갱신
// - 신뢰도·안정성 조건을 만족하면 자막 토큰으로 확정(debounce)
import { useCallback, useEffect, useRef, useState } from 'react'
import { Recognizer, type Prediction } from './model'
import { OnnxRecognizer } from './onnxRecognizer'
import { resampleSequence, SEQ_LEN, FEATURE_DIM } from './landmarks'
import { CONFIDENCE_THRESHOLD } from './labels'

const BUFFER_CAP = 48 // 최근 프레임 최대 보관 수
const INFER_MS = 250 // 추론 주기
const MIN_FRAMES = 12 // 최소 누적 프레임(이보다 적으면 추론 보류)
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
  clearTranscript: () => void
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
}

export function useRecognizer(enabled: boolean): UseRecognizerResult {
  const recognizerRef = useRef<Recognizer>(new Recognizer())
  const onnxRef = useRef<OnnxRecognizer>(new OnnxRecognizer())
  const bufRef = useRef<Float32Array[]>([])
  const [backend, setBackendState] = useState<Backend>('aihub')
  const [aihubInfo, setAihubInfo] = useState<{ num_classes: number; val_top1?: number } | null>(null)
  // ONNX 추론은 비동기다. 이전 추론이 끝나기 전에 또 넣으면 큐가 밀려 지연이 쌓인다.
  const inFlightRef = useRef(false)
  const [modelStatus, setModelStatus] = useState<ModelStatus>('idle')
  const [current, setCurrent] = useState<Prediction | null>(null)
  const [transcript, setTranscript] = useState<string[]>([])

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
    lastCommittedRef.current = ''
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
    onnxRef.current
      .load()
      .then(() => {
        const info = onnxRef.current.info
        if (info) setAihubInfo({ num_classes: info.num_classes, val_top1: info.val_top1 })
        setModelStatus('ready')
      })
      .catch((err) => {
        console.error('[recognizer] 실데이터 모델 로드 실패', err)
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
        }
      } else {
        pendingRef.current = { label: '', hits: 0 }
      }
    }

    const id = window.setInterval(() => {
      const buf = bufRef.current
      if (buf.length < MIN_FRAMES) return
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

  return {
    modelStatus,
    current,
    transcript,
    clearTranscript,
    pushFrame,
    captureWindow,
    recognizer: recognizerRef,
    setStatus: setModelStatus,
    reloadDefault,
    backend,
    setBackend,
    aihubInfo,
  }
}

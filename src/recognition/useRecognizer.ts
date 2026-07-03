// 실시간 시퀀스 인식 오케스트레이션 훅.
// - 특징 프레임을 링버퍼에 누적(pushFrame)
// - 일정 주기로 최근 윈도우를 리샘플 → GRU 추론 → 현재 키워드/신뢰도 갱신
// - 신뢰도·안정성 조건을 만족하면 자막 토큰으로 확정(debounce)
import { useCallback, useEffect, useRef, useState } from 'react'
import { Recognizer, type Prediction } from './model'
import { resampleSequence, SEQ_LEN, FEATURE_DIM } from './landmarks'
import { CONFIDENCE_THRESHOLD } from './labels'

const BUFFER_CAP = 48 // 최근 프레임 최대 보관 수
const INFER_MS = 250 // 추론 주기
const MIN_FRAMES = 12 // 최소 누적 프레임(이보다 적으면 추론 보류)
const STABLE_HITS = 2 // 같은 라벨이 연속 N회면 자막 확정

export type ModelStatus = 'idle' | 'loading' | 'ready' | 'custom' | 'error'

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
}

export function useRecognizer(enabled: boolean): UseRecognizerResult {
  const recognizerRef = useRef<Recognizer>(new Recognizer())
  const bufRef = useRef<Float32Array[]>([])
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

  // 기본 모델 로드(최초 1회).
  useEffect(() => {
    reloadDefault()
  }, [reloadDefault])

  // 추론 루프.
  useEffect(() => {
    if (!enabled) return
    const id = window.setInterval(() => {
      const rec = recognizerRef.current
      if (!rec.ready) return
      const buf = bufRef.current
      if (buf.length < MIN_FRAMES) return
      const seq = resampleSequence(buf, SEQ_LEN)
      if (seq.length !== SEQ_LEN * FEATURE_DIM) return
      const pred = rec.predict(seq)
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
    }, INFER_MS)
    return () => window.clearInterval(id)
  }, [enabled])

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
  }
}

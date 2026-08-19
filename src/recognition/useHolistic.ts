// 웹캠 + HolisticLandmarker 추론 루프를 관리하는 React 훅.
// - videoRef: 숨은 <video>(카메라 스트림), overlayRef: 랜드마크 오버레이 캔버스
// - 매 프레임 추론 → 오버레이 그리기 → onFrame(원시 프레임, 특징 벡터) 콜백
// 무거운 캔버스 드로잉은 imperative(rAF)로, UI 표시는 저빈도 state로 분리한다.
import { useCallback, useEffect, useRef, useState } from 'react'
import { HolisticEngine } from './holistic'
import { drawOverlay } from './drawOverlay'
import { frameToFeatures, type LandmarkFrame } from './landmarks'

export type HolisticStatus = 'idle' | 'loading' | 'running' | 'error'

export interface HolisticStats {
  fps: number
  poseOk: boolean
  leftOk: boolean
  rightOk: boolean
}

export interface UseHolisticResult {
  videoRef: React.RefObject<HTMLVideoElement | null>
  overlayRef: React.RefObject<HTMLCanvasElement | null>
  status: HolisticStatus
  stats: HolisticStats
  error: string | null
  start: () => void
  stop: () => void
}

interface Options {
  /** 매 유효 프레임마다 호출(특징 벡터는 어깨 미검출 시 null). */
  onFrame?: (frame: LandmarkFrame, features: Float32Array | null) => void
}

export function useHolistic(opts: Options = {}): UseHolisticResult {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const overlayRef = useRef<HTMLCanvasElement | null>(null)
  const engineRef = useRef<HolisticEngine | null>(null)
  const rafRef = useRef<number>(0)
  const streamRef = useRef<MediaStream | null>(null)
  const onFrameRef = useRef(opts.onFrame)
  onFrameRef.current = opts.onFrame

  const [status, setStatus] = useState<HolisticStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<HolisticStats>({ fps: 0, poseOk: false, leftOk: false, rightOk: false })

  // FPS 측정용(저빈도 state 반영).
  const frameTimes = useRef<number[]>([])

  const loop = useCallback(() => {
    const video = videoRef.current
    const engine = engineRef.current
    if (!video || !engine || !engine.ready) {
      rafRef.current = requestAnimationFrame(loop)
      return
    }
    const now = performance.now()
    if (video.readyState >= 2) {
      const frame = engine.detect(video, now)
      if (frame) {
        // 오버레이 캔버스 크기를 비디오에 맞춤.
        const canvas = overlayRef.current
        if (canvas) {
          const vw = video.videoWidth || 640
          const vh = video.videoHeight || 480
          if (canvas.width !== vw) canvas.width = vw
          if (canvas.height !== vh) canvas.height = vh
          const ctx = canvas.getContext('2d')
          if (ctx) drawOverlay(ctx, frame, vw, vh)
        }
        const features = frameToFeatures(frame)
        onFrameRef.current?.(frame, features)

        // FPS + 검출 상태(4Hz로만 state 갱신).
        const times = frameTimes.current
        times.push(now)
        while (times.length > 0 && now - times[0] > 1000) times.shift()
        setStatsThrottled(now, {
          fps: times.length,
          poseOk: frame.pose.length > 0,
          leftOk: frame.leftHand.length > 0,
          rightOk: frame.rightHand.length > 0,
        })
      }
    }
    rafRef.current = requestAnimationFrame(loop)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const lastStatsAt = useRef(0)
  const setStatsThrottled = (now: number, s: HolisticStats) => {
    if (now - lastStatsAt.current < 250) return
    lastStatsAt.current = now
    setStats(s)
  }

  const start = useCallback(() => {
    if (status === 'loading' || status === 'running') return
    setError(null)
    setStatus('loading')
    ;(async () => {
      try {
        if (!engineRef.current) {
          engineRef.current = new HolisticEngine()
          try {
            await engineRef.current.init('GPU')
          } catch {
            await engineRef.current.init('CPU')
          }
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: 'user' },
          audio: false,
        })
        streamRef.current = stream
        const video = videoRef.current
        if (!video) throw new Error('video element missing')
        video.srcObject = stream
        await video.play()
        setStatus('running')
        rafRef.current = requestAnimationFrame(loop)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        setStatus('error')
      }
    })()
  }, [status, loop])

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    const video = videoRef.current
    if (video) video.srcObject = null
    setStatus('idle')
    setStats({ fps: 0, poseOk: false, leftOk: false, rightOk: false })
  }, [])

  // 언마운트 정리.
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current)
      streamRef.current?.getTracks().forEach((t) => t.stop())
      engineRef.current?.close()
      engineRef.current = null
    }
  }, [])

  return { videoRef, overlayRef, status, stats, error, start, stop }
}

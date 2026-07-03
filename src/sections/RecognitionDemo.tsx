import { useCallback, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import SectionHeading from '../ui/SectionHeading'
import Button from '../ui/Button'
import { useHolistic } from '../recognition/useHolistic'
import type { LandmarkFrame } from '../recognition/landmarks'

/**
 * 실시간 수어 인식 데모 (입력 방향 파이프라인).
 * 웹캠 → MediaPipe Holistic → 포즈·양손 랜드마크 실시간 추출 → 오버레이 시각화.
 * (키워드 인식 → 자막은 Step2·4에서 이 프레임 스트림 위에 얹는다.)
 *
 * 모든 처리는 브라우저 안에서만 일어난다(영상은 서버로 전송하지 않음).
 */
export default function RecognitionDemo() {
  const [totalFrames, setTotalFrames] = useState(0)
  const framesRef = useRef(0)

  const onFrame = useCallback((_frame: LandmarkFrame, _features: Float32Array | null) => {
    framesRef.current += 1
    // 30프레임마다 카운터 반영(리렌더 절약).
    if (framesRef.current % 30 === 0) setTotalFrames(framesRef.current)
  }, [])

  const { videoRef, overlayRef, status, stats, error, start, stop } = useHolistic({ onFrame })

  const running = status === 'running'
  const loading = status === 'loading'

  return (
    <section id="live" className="relative border-t border-white/5 py-24 sm:py-32">
      <div className="mx-auto max-w-content px-6 lg:px-12">
        <SectionHeading
          eyebrow="실시간 인식 · Live"
          title={
            <>
              웹캠으로 <span className="text-cyan-soft text-glow">수어 동작을 실시간</span> 추출
            </>
          }
          description="MediaPipe Holistic이 웹캠 영상에서 상반신 포즈와 양손 21관절을 프레임마다 추출합니다. 이 좌표 스트림이 재난 키워드 인식·자막 생성의 입력이 됩니다. 영상은 브라우저 안에서만 처리되며 서버로 전송되지 않습니다."
        />

        <div className="mt-12 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          {/* 카메라 + 오버레이 스테이지 */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-white/10 bg-black/60"
          >
            {/* 거울(좌우 반전) 영상 */}
            <video
              ref={videoRef}
              playsInline
              muted
              className="absolute inset-0 h-full w-full -scale-x-100 object-cover opacity-90"
            />
            <canvas
              ref={overlayRef}
              className="absolute inset-0 h-full w-full"
              aria-hidden="true"
            />

            {!running && (
              <div className="absolute inset-0 grid place-items-center bg-black/50 backdrop-blur-sm">
                <div className="flex flex-col items-center gap-4 text-center">
                  <div className="grid h-16 w-16 place-items-center rounded-full border border-cyan-glow/40 bg-cyan-glow/10 text-3xl">
                    📹
                  </div>
                  {loading ? (
                    <p className="text-sm text-slate-300">모델·카메라 준비 중…</p>
                  ) : (
                    <>
                      <p className="max-w-xs text-sm text-slate-300">
                        카메라를 허용하면 실시간으로 손·상반신 랜드마크가 표시됩니다.
                      </p>
                      <Button onClick={start} variant="primary">
                        카메라 시작
                      </Button>
                    </>
                  )}
                  {error && (
                    <p className="max-w-xs text-xs text-red-300">
                      카메라를 시작하지 못했습니다: {error}
                    </p>
                  )}
                </div>
              </div>
            )}

            {running && (
              <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-cyan-soft backdrop-blur">
                <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
                LIVE · {stats.fps} fps
              </div>
            )}
          </motion.div>

          {/* 상태 패널 */}
          <div className="flex flex-col gap-4">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <h3 className="text-sm font-semibold text-white">추출 상태</h3>
              <dl className="mt-4 space-y-3 text-sm">
                <StatusRow label="상반신 포즈" ok={stats.poseOk} />
                <StatusRow label="왼손 (21관절)" ok={stats.leftOk} />
                <StatusRow label="오른손 (21관절)" ok={stats.rightOk} />
              </dl>
              <div className="mt-4 border-t border-white/10 pt-4 text-xs text-slate-400">
                <div className="flex justify-between">
                  <span>처리 속도</span>
                  <span className="tabular-nums text-slate-200">{stats.fps} fps</span>
                </div>
                <div className="mt-1 flex justify-between">
                  <span>누적 프레임</span>
                  <span className="tabular-nums text-slate-200">{totalFrames.toLocaleString()}</span>
                </div>
              </div>
            </div>

            {running && (
              <Button onClick={stop} variant="ghost">
                카메라 정지
              </Button>
            )}

            <p className="text-xs leading-relaxed text-slate-500">
              팁: 상반신이 화면에 들어오고 조명이 밝을수록 손 관절 추적이 안정적입니다. GPU 가속이
              가능한 브라우저(Chrome 권장)에서 가장 부드럽게 동작합니다.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

function StatusRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-slate-300">{label}</dt>
      <dd
        className={`inline-flex items-center gap-1.5 text-xs font-medium ${
          ok ? 'text-lime-300' : 'text-slate-500'
        }`}
      >
        <span className={`h-2 w-2 rounded-full ${ok ? 'bg-lime-400' : 'bg-slate-600'}`} />
        {ok ? '감지됨' : '대기'}
      </dd>
    </div>
  )
}

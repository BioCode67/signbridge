import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import SectionHeading from '../ui/SectionHeading'
import { drawFrame, type ViewMode } from './sign/renderSign'
import { useSignData } from './sign/useSignData'

// 3D avatar (Three.js + VRM) is heavy — load it only when the user opens 3D mode.
const Avatar3D = lazy(() => import('./sign/Avatar3D'))

/** 2D comparison modes + the rigged 3D mode. */
type DisplayMode = ViewMode | '3d'
const MODE_LABELS: Record<DisplayMode, string> = {
  avatar: '아바타',
  skeleton: '스켈레톤',
  '3d': '3D',
}
const MODES: DisplayMode[] = ['avatar', 'skeleton', '3d']

const SPEEDS = [0.5, 1, 1.5] as const

/** Strip the trailing disambiguation marks ("오늘1", "차오르다1#") for display. */
function cleanGloss(g: string): string {
  return g.replace(/[0-9#:]+$/, '')
}

export default function SignAvatarDemo() {
  const load = useSignData()
  const sentences = load.sentences

  const [index, setIndex] = useState(0)
  const [frame, setFrame] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<number>(1)
  const [mode, setMode] = useState<DisplayMode>('avatar')

  const data = sentences[index]

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)

  // Mutable mirrors so the rAF loop reads fresh values without re-subscribing.
  const frameRef = useRef(0)
  const speedRef = useRef(1)
  const playingRef = useRef(false)
  const rafRef = useRef<number>(0)
  const lastRef = useRef(0)

  useEffect(() => { frameRef.current = frame }, [frame])
  useEffect(() => { speedRef.current = speed }, [speed])
  useEffect(() => { playingRef.current = playing }, [playing])

  // --- Size the canvas backing store to its CSS box (DPR-aware) ---
  const syncCanvasSize = useCallback(() => {
    const cv = canvasRef.current
    if (!cv) return
    const rect = cv.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const w = Math.round(rect.width * dpr)
    const h = Math.round(rect.height * dpr)
    if (cv.width !== w || cv.height !== h) {
      cv.width = w
      cv.height = h
    }
  }, [])

  // --- The single redraw path: any change to frame/mode/data repaints. ---
  const paint = useCallback(() => {
    if (mode === '3d') return // 3D is rendered by its own R3F canvas
    const cv = canvasRef.current
    if (!cv || !data) return
    drawFrame(cv, data, frameRef.current, mode)
  }, [data, mode])

  useLayoutEffect(() => {
    syncCanvasSize()
    paint()
  }, [frame, mode, index, syncCanvasSize, paint])

  // Repaint on container resize (responsive + DPR changes).
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const ro = new ResizeObserver(() => {
      syncCanvasSize()
      paint()
    })
    ro.observe(stage)
    return () => ro.disconnect()
  }, [syncCanvasSize, paint])

  // --- Playback loop ---
  useEffect(() => {
    if (!playing || !data) return
    lastRef.current = 0
    const step = (ts: number) => {
      if (!playingRef.current) return
      const interval = 1000 / data.fps / speedRef.current
      if (ts - lastRef.current >= interval) {
        lastRef.current = ts
        let next = frameRef.current + 1
        if (next >= data.num_frames) {
          next = 0
          frameRef.current = 0
          setFrame(0)
          setPlaying(false)
          return
        }
        frameRef.current = next
        setFrame(next)
      }
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(rafRef.current)
  }, [playing, data])

  // --- Switching sentence resets playback ---
  const selectSentence = useCallback((i: number) => {
    setIndex(i)
    setPlaying(false)
    setFrame(0)
    frameRef.current = 0
  }, [])

  const reset = useCallback(() => {
    setPlaying(false)
    setFrame(0)
    frameRef.current = 0
  }, [])

  const togglePlay = useCallback(() => {
    if (!data) return
    setPlaying((p) => {
      const next = !p
      if (next && frameRef.current >= data.num_frames - 1) {
        frameRef.current = 0
        setFrame(0)
      }
      return next
    })
  }, [data])

  const time = data ? frame / data.fps : 0
  const activeGloss = useMemo(() => {
    if (!data) return new Set<number>()
    const s = new Set<number>()
    data.gloss_sequence.forEach((g, i) => {
      if (time >= g.start && time <= g.end) s.add(i)
    })
    return s
  }, [data, time])

  return (
    <section id="demo" className="section-pad relative">
      {/* ambient glow behind the stage */}
      <div className="pointer-events-none absolute left-1/2 top-1/3 -z-0 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-cyan-glow/10 blur-[120px]" />

      <div className="relative mx-auto max-w-content">
        <SectionHeading
          eyebrow="LIVE SIGN AVATAR"
          title={
            <>
              실제 키포인트로 움직이는 <span className="text-cyan-soft text-glow">수어 아바타</span>
            </>
          }
          description={
            <>
              AI Hub「재난 안전 정보 전달을 위한 수어영상」데이터의 실제 OpenPose 키포인트를
              아바타로 렌더링했습니다. 농인이 직접 수어한 동작이며, 표정(입·눈썹)은 비수지 정보를
              반영합니다.
            </>
          }
        />

        <motion.div
          initial={{ opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className="mx-auto mt-14 max-w-3xl"
        >
          {load.status === 'error' ? (
            <div className="rounded-2xl border border-red-400/30 bg-red-500/5 p-8 text-center text-sm text-red-200">
              데이터를 불러오지 못했습니다: {load.message}
            </div>
          ) : (
            <>
              {/* Tabs (auto-generated from manifest) */}
              <div className="mb-4 flex flex-wrap gap-2">
                {load.status === 'loading'
                  ? Array.from({ length: 6 }).map((_, i) => (
                      <span
                        key={i}
                        className="h-9 w-32 animate-pulse rounded-lg border border-white/5 bg-space-800"
                      />
                    ))
                  : sentences.map((s, i) => (
                      <button
                        key={s.file}
                        type="button"
                        onClick={() => selectSentence(i)}
                        title={s.korean_text}
                        className={`max-w-[210px] truncate rounded-lg border px-3 py-2 text-xs transition-all ${
                          i === index
                            ? 'border-cyan-glow bg-cyan-glow/10 text-cyan-soft'
                            : 'border-white/10 bg-space-800 text-slate-400 hover:border-cyan-glow/40 hover:text-slate-200'
                        }`}
                      >
                        {i + 1}. {s.korean_text.slice(0, 12)}…
                      </button>
                    ))}
              </div>

              {/* Stage */}
              <div
                ref={stageRef}
                className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-white/10"
                style={{
                  background:
                    'radial-gradient(ellipse at 50% 30%, #16263f, #0a1322 60%, #070b14)',
                }}
              >
                <span className="absolute left-3 top-3 z-10 rounded-md border border-cyan-glow/30 bg-cyan-glow/10 px-2.5 py-1 text-[10.5px] tracking-wide text-cyan-soft">
                  {mode === '3d' ? 'VRM · 3D 아바타' : 'REAL KEYPOINT · OpenPose'}
                </span>
                <div className="absolute right-3 top-3 z-10 flex gap-1">
                  {MODES.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(m)}
                      className={`rounded-md border px-2.5 py-1.5 text-[11px] transition-colors ${
                        mode === m
                          ? 'border-cyan-glow bg-cyan-glow text-space-950 font-bold'
                          : 'border-white/10 bg-space-900/80 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {MODE_LABELS[m]}
                    </button>
                  ))}
                </div>

                {/* 3D mode renders its own R3F canvas; 2D modes use the 2D canvas. */}
                {mode === '3d' ? (
                  <Suspense
                    fallback={
                      <div className="absolute inset-0 grid place-items-center text-sm text-slate-500">
                        <span className="animate-pulse">3D 아바타 모델을 불러오는 중…</span>
                      </div>
                    }
                  >
                    <Avatar3D data={data} frame={frame} animate />
                  </Suspense>
                ) : (
                  <canvas ref={canvasRef} className="block h-full w-full" />
                )}

                {mode === '3d' && (
                  <span className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-white/10 bg-space-900/70 px-3 py-1 text-[10.5px] text-slate-400 backdrop-blur-sm">
                    드래그로 360° 회전 · 휠로 확대
                  </span>
                )}

                {load.status === 'loading' && (
                  <div className="absolute inset-0 grid place-items-center text-sm text-slate-500">
                    <span className="animate-pulse">키포인트 데이터를 불러오는 중…</span>
                  </div>
                )}
              </div>

              {/* Korean source text */}
              <div className="mt-4 rounded-xl border border-white/10 bg-space-800 px-4 py-3.5 text-[15px] leading-relaxed">
                <span className="mb-1.5 block text-[11px] font-bold tracking-[0.1em] text-cyan-soft">
                  원문 (재난 안전 안내문자)
                </span>
                <span className="text-slate-100">
                  {data ? data.korean_text : ' '}
                </span>
              </div>

              {/* Gloss chips */}
              <div className="mt-3 flex flex-wrap gap-2">
                {data?.gloss_sequence.map((g, i) => (
                  <span
                    key={`${g.gloss}-${i}`}
                    className={`rounded-full border px-3 py-1.5 text-[12.5px] transition-all ${
                      activeGloss.has(i)
                        ? 'border-cyan-glow bg-cyan-glow font-bold text-space-950 shadow-[0_0_14px_rgba(34,211,238,0.5)]'
                        : 'border-white/10 bg-space-800 text-slate-500'
                    }`}
                  >
                    {cleanGloss(g.gloss)}
                  </span>
                ))}
              </div>

              {/* Seek */}
              <input
                type="range"
                min={0}
                max={data ? data.num_frames - 1 : 0}
                step={1}
                value={frame}
                disabled={!data}
                onChange={(e) => {
                  setPlaying(false)
                  const f = Number(e.target.value)
                  frameRef.current = f
                  setFrame(f)
                }}
                className="seek mt-5 w-full"
                aria-label="타임라인"
              />

              {/* Controls */}
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={togglePlay}
                  disabled={!data}
                  className="rounded-lg bg-cyan-glow px-5 py-2.5 text-sm font-bold text-space-950 transition-colors hover:bg-cyan-soft disabled:opacity-40"
                >
                  {playing ? '❚❚ 일시정지' : '▶ 재생'}
                </button>
                <button
                  type="button"
                  onClick={reset}
                  className="rounded-lg border border-white/10 px-5 py-2.5 text-sm text-slate-300 transition-colors hover:border-cyan-glow/40 hover:text-cyan-soft"
                >
                  처음으로
                </button>
                <div className="flex gap-1">
                  {SPEEDS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSpeed(s)}
                      className={`rounded-lg border px-3 py-2 text-xs transition-colors ${
                        speed === s
                          ? 'border-cyan-glow bg-cyan-glow/10 text-cyan-soft'
                          : 'border-white/10 bg-space-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {s}×
                    </button>
                  ))}
                </div>
                <span className="ml-auto font-mono text-sm tabular-nums text-slate-500">
                  {time.toFixed(1)}s
                </span>
              </div>

              <p className="mt-6 border-t border-white/10 pt-5 text-xs leading-relaxed text-slate-500">
                재난 안전 공지(텍스트)를 한국수어로 변환해 아바타로 표현하는 데모입니다. 실제 농인이
                수어한 동작을 OpenPose로 추출한 2D 키포인트에 형태를 입혀 렌더링했으며, 표정(입·눈썹)은
                데이터의 비수지 정보를 반영합니다. 본 과제의 목표는 재난 공지 발생 즉시 이 변환을 수행해
                KOREN 저지연망으로 전국 다채널에 실시간 송출하는 것입니다.
              </p>
            </>
          )}
        </motion.div>
      </div>
    </section>
  )
}

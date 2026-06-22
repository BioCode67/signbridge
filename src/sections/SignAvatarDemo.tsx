import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { motion } from 'framer-motion'
import SectionHeading from '../ui/SectionHeading'
import { drawFrame, type ViewMode } from './sign/renderSign'
import { useSignData } from './sign/useSignData'
import { AVATARS } from './sign/avatars'
import AvatarErrorBoundary from './sign/AvatarErrorBoundary'

// 3D avatar (Three.js + VRM) is heavy — load it only when the user opens 3D mode.
const Avatar3D = lazy(() => import('./sign/Avatar3D'))

/** Rigged 3D avatar (primary) + skeleton keypoint view (comparison). */
type DisplayMode = ViewMode | '3d'
const MODE_LABELS: Record<DisplayMode, string> = {
  avatar: '2D 아바타',
  skeleton: '스켈레톤',
  '3d': '3D 아바타',
}
const MODES: DisplayMode[] = ['3d', 'avatar', 'skeleton']

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
  const [mode, setMode] = useState<DisplayMode>('3d')
  const [avatarUrl, setAvatarUrl] = useState(AVATARS[0].url)
  const [customUrl, setCustomUrl] = useState('')
  const objUrlRef = useRef<string | null>(null)

  // Switch the model, revoking any previous object-URL (uploaded file) to avoid
  // leaks. Accepts a bundled URL, a remote URL, or a blob: URL from a file.
  const setModel = useCallback((url: string) => {
    if (objUrlRef.current && objUrlRef.current !== url) {
      URL.revokeObjectURL(objUrlRef.current)
      objUrlRef.current = null
    }
    setAvatarUrl(url)
  }, [])

  // Load a user-supplied model by URL (RPM/Avaturn/VRoid .glb or .vrm). The
  // avatar's ErrorBoundary catches a bad URL/CORS failure with a friendly note.
  const loadCustom = useCallback(() => {
    const url = customUrl.trim()
    if (/^https?:\/\/.+\.(glb|vrm)(\?.*)?$/i.test(url)) setModel(url)
  }, [customUrl, setModel])

  // Load a model from a local file the user downloaded anywhere (VRoid Hub,
  // Booth, Sketchfab, Mixamo→glb, …). No hosting/URL needed.
  const onFile = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file later
    if (!file || !/\.(glb|vrm)$/i.test(file.name)) return
    const url = URL.createObjectURL(file)
    objUrlRef.current = url
    setModel(url)
  }, [setModel])

  const customActive = !AVATARS.some((a) => a.url === avatarUrl)

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
              AI Hub「재난 안전 정보 전달을 위한 수어영상」데이터의 실제 손·팔 관절 좌표를 3D 아바타로
              리타게팅해 재현했습니다. 농인이 직접 수어한 동작이며, 무거운 영상이 아니라 관절 좌표만
              전송해 렌더링합니다. 지진·태풍·호우·대설·산불·미세먼지 등 다양한 재난 유형을 수록했습니다.
            </>
          }
        />

        {load.status === 'ready' && (
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="mx-auto mt-5 flex max-w-3xl flex-wrap items-center justify-center gap-2 text-xs text-slate-400"
          >
            <span className="rounded-full border border-cyan-glow/30 bg-cyan-glow/10 px-3 py-1 font-semibold text-cyan-soft">
              재난 문장 {sentences.length}종
            </span>
            <span className="rounded-full border border-white/10 bg-space-800 px-3 py-1">
              AI Hub 실데이터
            </span>
            <span className="rounded-full border border-white/10 bg-space-800 px-3 py-1">
              3D 아바타 · 스켈레톤(키포인트)
            </span>
          </motion.div>
        )}

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
                role="img"
                aria-label={data ? `수어 아바타가 표현하는 문장: ${data.korean_text}` : '수어 아바타'}
                className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-white/10"
                style={{
                  background:
                    'radial-gradient(ellipse at 50% 30%, #16263f, #0a1322 60%, #070b14)',
                }}
              >
                <span className="absolute left-3 top-3 z-10 rounded-md border border-cyan-glow/30 bg-cyan-glow/10 px-2.5 py-1 text-[10.5px] tracking-wide text-cyan-soft">
                  {mode === '3d'
                    ? '실사 3D 아바타 · 관절 리타게팅'
                    : mode === 'avatar'
                      ? '클린 2D 아바타 · 관절 구동'
                      : 'REAL KEYPOINT · OpenPose'}
                </span>
                <div className="absolute right-3 top-3 z-10 flex gap-1">
                  {MODES.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(m)}
                      aria-pressed={mode === m}
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
                  <AvatarErrorBoundary resetKey={avatarUrl}>
                    <Suspense
                      fallback={
                        <div className="absolute inset-0 grid place-items-center text-sm text-slate-500">
                          <span className="animate-pulse">3D 아바타 모델을 불러오는 중…</span>
                        </div>
                      }
                    >
                      <Avatar3D data={data} frame={frame} animate modelUrl={avatarUrl} />
                    </Suspense>
                  </AvatarErrorBoundary>
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

              {/* Avatar picker (3D mode) */}
              {mode === '3d' && (
                <div className="mt-4">
                  <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold tracking-wide text-slate-500">
                    <span>아바타 선택</span>
                    <span className="text-slate-600">· 실사·앵커 등 {AVATARS.length}종</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {AVATARS.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => setModel(a.url)}
                        className={`rounded-lg border px-3 py-1.5 text-xs transition-all ${
                          avatarUrl === a.url
                            ? 'border-cyan-glow bg-cyan-glow/10 text-cyan-soft'
                            : 'border-white/10 bg-space-800 text-slate-400 hover:border-cyan-glow/40 hover:text-slate-200'
                        }`}
                      >
                        {a.label}
                      </button>
                    ))}
                    {customActive && (
                      <span className="rounded-lg border border-cyan-glow bg-cyan-glow/10 px-3 py-1.5 text-xs text-cyan-soft">
                        내 아바타 ✓
                      </span>
                    )}
                  </div>

                  {/* Custom model loader — upload a local file OR paste a URL */}
                  <div className="mt-3 rounded-xl border border-white/10 bg-space-800/40 p-3">
                    <label className="mb-2 block text-[11px] font-semibold text-slate-400">
                      내 아바타 불러오기 — 리깅된 <span className="text-cyan-soft">.glb / .vrm</span>
                    </label>

                    {/* 1) File upload — works with a model downloaded from anywhere */}
                    <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-cyan-glow/40 bg-cyan-glow/[0.05] px-4 py-3 text-xs font-semibold text-cyan-soft transition-colors hover:bg-cyan-glow/10">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                      </svg>
                      내 컴퓨터에서 파일 선택 (.glb / .vrm)
                      <input type="file" accept=".glb,.vrm,model/gltf-binary" onChange={onFile} className="hidden" />
                    </label>

                    {/* 2) Or paste a hosted URL */}
                    <form
                      onSubmit={(e) => {
                        e.preventDefault()
                        loadCustom()
                      }}
                      className="mt-2 flex gap-2"
                    >
                      <input
                        type="url"
                        value={customUrl}
                        onChange={(e) => setCustomUrl(e.target.value)}
                        placeholder="또는 주소 붙여넣기 — https://…​.glb / .vrm"
                        className="min-w-0 flex-1 rounded-lg border border-white/10 bg-space-900 px-3 py-2 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-cyan-glow/50"
                      />
                      <button
                        type="submit"
                        className="shrink-0 rounded-lg border border-white/10 bg-space-800 px-4 py-2 text-xs font-bold text-slate-200 transition-colors hover:border-cyan-glow/40 hover:text-cyan-soft"
                      >
                        불러오기
                      </button>
                    </form>
                  </div>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-slate-600">
                    VRoid Hub·Booth·Sketchfab 등에서 받은 파일을 그대로 선택하면 즉시 수어로 구동됩니다. 파일은 브라우저 안에서만 처리되며 업로드되지 않습니다. (표준 휴머노이드 본 + 손가락 필요)
                  </p>
                </div>
              )}

              {/* Roadmap note — honest framing of the demo avatar's current limits */}
              <p className="mt-4 rounded-xl border border-white/10 bg-space-800/40 px-4 py-3 text-[12px] leading-relaxed text-slate-400">
                <span className="font-semibold text-slate-300">참고 </span>· 현재 아바타는 데모용으로 직접 제작해 손동작·표정의 완성도가
                제한적입니다. 본 과제 선정 시 지원금으로 더 정교한 전문 아바타를 도입해 수어 전달의 정확도와 디자인을 고도화할 예정입니다.
              </p>

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
                수어한 동작을 OpenPose로 추출한 관절 키포인트에 형태를 입혀 3D로 리타게팅했습니다. 본
                과제의 목표는 재난 공지 발생 즉시 이 변환을 수행해, 영상이 아닌 경량 관절 좌표(약
                0.1Mbps)만 KOREN 저지연망으로 보내 전국 다채널에 실시간 송출하는 것입니다. 비수지(표정·
                입모양)는 전체 시스템에서 단계적으로 정밀화합니다.
              </p>
            </>
          )}
        </motion.div>
      </div>
    </section>
  )
}

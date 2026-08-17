import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { motion } from 'framer-motion'
import SectionHeading from '../ui/SectionHeading'
import { API_URL } from '../config'
import { useSpeechInput } from '../hooks/useSpeechInput'
import { DictSignAgent } from '../agents/dictSignAgent'
import { composeGlosses, type BankIndex } from './sign/composeLocal'
import type { SignData } from './sign/signTypes'
import { drawFrame, type ViewMode } from './sign/renderSign'
import { useSignData } from './sign/useSignData'
import { AVATARS } from './sign/avatars'
import AvatarErrorBoundary from './sign/AvatarErrorBoundary'
import LiveConsole from './sign/LiveConsole'

// 3D avatar (Three.js + VRM) is heavy — load it only when the user opens 3D mode.
const Avatar3D = lazy(() => import('./sign/Avatar3D'))

/** Rigged 3D avatar (primary) + skeleton keypoint view (comparison). */
type DisplayMode = ViewMode | '3d'
const MODE_LABELS: Record<DisplayMode, string> = {
  avatar: '2D 아바타',
  skeleton: '스켈레톤',
  '3d': '3D 아바타',
}
const MODES: DisplayMode[] = ['3d', 'skeleton']

const SPEEDS = [0.5, 1, 1.5] as const

/** Strip the trailing disambiguation marks ("오늘1", "차오르다1#") for display. */
function cleanGloss(g: string): string {
  return g.replace(/[0-9#:]+$/, '')
}

// AI 번역 서버(FastAPI /compose). 주소는 src/config.ts(VITE_API_URL)에서 온다.
// 서버가 없어도 수록 문장 재생·아바타는 그대로 동작한다.

export default function SignAvatarDemo() {
  const load = useSignData()

  // AI 합성 결과 — 수록 문장 목록 맨 앞에 탭으로 끼어든다.
  const [composed, setComposed] = useState<(typeof load.sentences)[number] | null>(null)
  const [aiText, setAiText] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiNote, setAiNote] = useState('')
  const sentences = useMemo(
    () => (composed ? [composed, ...load.sentences] : load.sentences),
    [composed, load.sentences],
  )

  const [index, setIndex] = useState(0)
  const [frame, setFrame] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<number>(1)
  const [mode, setMode] = useState<DisplayMode>('3d')
  // 자막 — 수어를 모르는 청중에게 아바타 동작과 단어를 연결해 준다. 기본 켬.
  const [captions, setCaptions] = useState(true)
  // 연속 방송 — 문장이 끝나면 다음 문장으로 이어 재생(무인 재난방송 시연용).
  const [broadcast, setBroadcast] = useState(false)
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
  // rAF 루프가 최신 값을 읽되 루프를 다시 만들지 않도록 ref로 거울을 둔다.
  // (재생 중 이 값들이 바뀌어도 애니메이션이 끊기면 안 된다)
  const broadcastRef = useRef(false)
  const sentencesRef = useRef(0)
  useEffect(() => { broadcastRef.current = broadcast }, [broadcast])
  useEffect(() => { sentencesRef.current = sentences.length }, [sentences.length])

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
        const next = frameRef.current + 1
        if (next >= data.num_frames) {
          frameRef.current = 0
          setFrame(0)
          // 연속 방송: 문장이 끝나면 다음 문장으로 넘어가 계속 재생한다.
          // 실제 재난방송은 한 문장으로 끝나지 않는다 — 여러 공지가 순서대로 나간다.
          if (broadcastRef.current) {
            setIndex((i) => (i + 1) % Math.max(1, sentencesRef.current))
            rafRef.current = requestAnimationFrame(step)
            return
          }
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

  // 브라우저 단독 경로 — 사전으로 번역하고 정적 동작 조각을 이어 붙인다.
  // 조각은 한 번 받으면 캐시한다(같은 단어가 문장마다 반복되므로 효과가 크다).
  const serverDownRef = useRef(false)
  const dictAgentRef = useRef<DictSignAgent | null>(null)
  const bankRef = useRef<BankIndex | null>(null)
  const glossCacheRef = useRef(new Map<string, SignData>())

  const composeInBrowser = useCallback(async (text: string) => {
    if (!dictAgentRef.current) dictAgentRef.current = new DictSignAgent()
    const base = import.meta.env.BASE_URL
    if (!bankRef.current) {
      const res = await fetch(`${base}data/bank.json`)
      if (!res.ok) throw new Error('동작 사전을 불러오지 못했습니다')
      bankRef.current = (await res.json()) as BankIndex
    }
    const { gloss, unmatched } = await dictAgentRef.current.convert(text)
    const local = await composeGlosses(text, gloss, bankRef.current, async (name, entry) => {
      const hit = glossCacheRef.current.get(name)
      if (hit) return hit
      const res = await fetch(`${base}data/glosses/${entry.file}`)
      if (!res.ok) throw new Error(name)
      const data = (await res.json()) as SignData
      glossCacheRef.current.set(name, data)
      return data
    })
    // 번역 단계에서 빠진 낱말도 "건너뜀" 집계에 넣는다 — 조용한 손실 금지.
    if (local && unmatched?.length) {
      local.gloss_missing = [...new Set([...local.gloss_missing, ...unmatched])]
    }
    return local
  }, [])

  // 관제 화면용 — 번역·합성 각 단계를 **실제로 재서** 돌려준다.
  // 지어낸 숫자를 띄우면 데모가 아니라 연출이 된다.
  const translateMeasured = useCallback(async (text: string) => {
    const t0 = performance.now()
    // 서버가 없는 것으로 확인되면 다시 찔러 보지 않는다. 매 건마다 실패 왕복을
    // 반복하면 관제 화면의 지연 수치가 실제보다 나쁘게 보인다.
    if (serverDownRef.current) {
      const local = await composeInBrowser(text)
      if (!local) return null
      setComposed({ ...local, file: '__ai__' } as never)
      setIndex(0); setFrame(0); frameRef.current = 0; setPlaying(true)
      return {
        gloss: local.gloss_sequence.map((g) => g.gloss),
        missing: local.gloss_missing,
        backend: '브라우저 사전',
        translateMs: 0,
        composeMs: local.buildMs,
      }
    }
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 8000)
      const res = await fetch(`${API_URL}/compose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({ text }),
      })
      clearTimeout(timer)
      if (res.ok) {
        const json = await res.json()
        if (!json.error) {
          const t1 = performance.now()
          setComposed({ ...json, file: '__ai__' } as never)
          setIndex(0); setFrame(0); frameRef.current = 0; setPlaying(true)
          return {
            gloss: (json.gloss_sequence ?? []).map((g: { gloss: string }) => g.gloss),
            missing: json.gloss_missing ?? [],
            backend: 'KoBART 서버',
            translateMs: t1 - t0,
            composeMs: 0,
          }
        }
      }
    } catch {
      serverDownRef.current = true // 다음 건부터는 바로 브라우저 경로로 간다
    }
    const t1 = performance.now()
    const local = await composeInBrowser(text)
    if (!local) return null
    setComposed({ ...local, file: '__ai__' } as never)
    setIndex(0); setFrame(0); frameRef.current = 0; setPlaying(true)
    return {
      gloss: local.gloss_sequence.map((g) => g.gloss),
      missing: local.gloss_missing,
      backend: '브라우저 사전',
      translateMs: t1 - t0,
      composeMs: local.buildMs,
    }
  }, [composeInBrowser])


  // 임의 문장 → 수어 동작 → 즉시 재생.
  //
  // **서버가 있으면 서버, 없으면 브라우저**로 처리한다. 서버(KoBART)가 어순까지 배워
  // 품질이 더 좋지만, 정적 배포에서는 서버가 없다. 그래서 실패하면 조용히 브라우저
  // 사전 경로로 내려간다 — 사이트가 어떤 상황에서도 동작해야 한다.
  // 인자로 문장을 받으면 그것을, 없으면 입력창 값을 쓴다(음성 인식이 직접 넘긴다).
  const composeText = useCallback(async (override?: string) => {
    const text = (override ?? aiText).trim()
    if (!text || aiBusy) return
    setAiBusy(true)
    setAiNote('')

    const show = (data: object, missing: string[], how: string) => {
      setComposed({ ...(data as typeof composed), file: '__ai__' } as never)
      setIndex(0)
      setFrame(0)
      frameRef.current = 0
      setPlaying(true)
      const skipped = missing.length ? ` · 동작 없는 단어 ${missing.length}개 건너뜀` : ''
      setAiNote(`${how}${skipped}`)
    }

    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 15000)
      const res = await fetch(`${API_URL}/compose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({ text }),
      })
      clearTimeout(timer)
      if (!res.ok) throw new Error(String(res.status))
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      show(json, json.gloss_missing ?? [], 'AI 번역 모델(KoBART)로 생성')
      setAiBusy(false) // 이 경로엔 finally가 없다 — 여기서 풀지 않으면 버튼이 잠긴 채 남는다
      return
    } catch {
      // 서버가 없거나 느림 — 브라우저 사전으로 간다. 사용자에게는 실패가 아니다.
    }

    try {
      const local = await composeInBrowser(text)
      if (!local) {
        setAiNote('이 문장에서 표현 가능한 수어 단어를 찾지 못했습니다. 다르게 써 보세요.')
        return
      }
      show(local, local.gloss_missing, '브라우저 내장 사전으로 생성')
    } catch (err) {
      setAiNote(`번역 실패: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setAiBusy(false)
    }
    setAiBusy(false)
  }, [aiText, aiBusy, composeInBrowser])

  // ── 수어 사전 검색 — 단어를 찾으면 아바타가 그 수어를 보여 준다 ──
  // 동작 사전(수천 단어)을 번역의 부품으로만 쓰지 않고, 그 자체를 "수어 사전"으로
  // 직접 찾아볼 수 있게 한다. 수어를 배우는 청인·가족에게 가장 직관적인 기능이다.
  const [dictQuery, setDictQuery] = useState('')
  const [dictHits, setDictHits] = useState<string[]>([])
  const searchDict = useCallback(async (q: string) => {
    setDictQuery(q)
    const query = q.trim()
    if (!query) { setDictHits([]); return }
    const base = import.meta.env.BASE_URL
    if (!bankRef.current) {
      const res = await fetch(`${base}data/bank.json`)
      if (!res.ok) return
      bankRef.current = (await res.json()) as BankIndex
    }
    const keys = Object.keys(bankRef.current)
    // 앞부분 일치를 먼저, 부분 일치를 뒤에 — "비"를 치면 "비내리다"가 위로 온다.
    const starts = keys.filter((k) => k.startsWith(query))
    const contains = keys.filter((k) => !k.startsWith(query) && k.includes(query))
    setDictHits([...starts, ...contains].slice(0, 14))
  }, [])

  const playDictWord = useCallback(async (gloss: string) => {
    const base = import.meta.env.BASE_URL
    if (!bankRef.current) return
    const composed = await composeGlosses(gloss, [gloss], bankRef.current, async (name, entry) => {
      const hit = glossCacheRef.current.get(name)
      if (hit) return hit
      const res = await fetch(`${base}data/glosses/${entry.file}`)
      if (!res.ok) throw new Error(name)
      const json = (await res.json()) as SignData
      glossCacheRef.current.set(name, json)
      return json
    })
    if (!composed) return
    setComposed({ ...composed, korean_text: `수어 사전: ${gloss.replace(/[0-9#:]+$/, '')}`, file: '__ai__' } as never)
    setIndex(0); setFrame(0); frameRef.current = 0; setPlaying(true)
  }, [])

  // 다른 섹션(웹캠 인식 Q&A 등)이 "이 문장을 수어로"라고 보낼 수 있는 통로.
  // 농인이 수어로 질문 → 시스템이 답변 → **아바타가 수어로 응답**하는 왕복 루프의 마지막 다리다.
  useEffect(() => {
    const onSpeak = (e: Event) => {
      const text = (e as CustomEvent<{ text?: string }>).detail?.text
      if (!text) return
      setAiText(text)
      void composeText(text)
      document.getElementById('demo')?.scrollIntoView({ behavior: 'smooth' })
    }
    window.addEventListener('signbridge:sign-text', onSpeak)
    return () => window.removeEventListener('signbridge:sign-text', onSpeak)
  }, [composeText])

  // 음성 → 텍스트 → 곧바로 수어 번역. 확정된 문장만 넘어온다.
  const speech = useSpeechInput(
    useCallback((text: string) => {
      setAiText(text)
      void composeText(text)
    }, [composeText]),
  )

  // 말하는 **도중에** 글로스를 미리 보여 준다.
  // 확정 전까지 화면이 비어 있으면 "받아쓰기만 하는 것"처럼 보인다. 중간 결과를
  // 사전으로 즉시 훑어 단어가 쌓이는 것을 보이면 번역이 진행 중임이 드러난다.
  // (실제 합성은 확정된 문장으로만 한다 — 중간 결과로 합성하면 같은 문장을 여러 번 만든다)
  const [previewGloss, setPreviewGloss] = useState<string[]>([])
  useEffect(() => {
    if (!speech.interim) {
      setPreviewGloss([])
      return
    }
    let alive = true
    if (!dictAgentRef.current) dictAgentRef.current = new DictSignAgent()
    void dictAgentRef.current.convert(speech.interim).then((r) => {
      if (alive) setPreviewGloss(r.gloss)
    })
    return () => { alive = false }
  }, [speech.interim])

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

  // 자막에 띄울 현재 글로스. 여러 층렬이 겹치면 시작이 이른 것부터 붙여 보여 준다.
  const currentGlossText = useMemo(() => {
    if (!data) return ''
    return [...activeGloss]
      .sort((a, b) => data.gloss_sequence[a].start - data.gloss_sequence[b].start)
      .map((i) => cleanGloss(data.gloss_sequence[i].gloss))
      .join(' · ')
  }, [data, activeGloss])

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
              <strong className="text-slate-200">어떤 재난 문장이든</strong> 말하거나 입력하면 AI가
              한국수어로 번역해 아바타가 표현합니다. 학습 모델이 문장을 수어 어순의 글로스로 옮기고,
              AI Hub「재난 안전 정보 전달을 위한 수어영상」의 <strong className="text-slate-200">실제
              농인 수어자 53명</strong> 동작에서 각 단어를 찾아 이어 붙입니다. 무거운 영상이 아니라
              관절 좌표만 전송해 렌더링합니다. 아래 탭은 원본 데이터를 그대로 재생하는 예시입니다.
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
            {/* 수록본과 AI 생성을 나눠 표시한다. 합계만 보이면 "이 개수만 된다"로
                오해를 준다 — AI 번역은 입력하는 만큼 무제한이다. */}
            <span className="rounded-full border border-cyan-glow/40 bg-cyan-glow/10 px-3 py-1 font-semibold text-cyan-soft">
              AI 번역 · 문장 수 제한 없음
            </span>
            {/* 실제 재난문자 246건 전수 실측(사전 매칭 손실 포함) — 부풀림 없는 종단 수치 */}
            <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 font-semibold text-emerald-300">
              동작 어휘 10,175종 · 실측 낱말 표현 재난문자 95.5% · 창구 대화 84.5%
            </span>
            <span className="rounded-full border border-white/10 bg-space-800 px-3 py-1">
              사전 수록 {load.sentences.length}문장 (AI Hub 원본 재생)
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
              {/* 실시간 관제 — 실제 재난문자가 들어와 번역·송출되는 과정을 보여 준다.
                  탭을 눌러 재생하는 화면만 있으면 "미리 만든 영상"으로 보이기 때문이다. */}
              <LiveConsole translate={translateMeasured} playing={playing} />

              {/* AI 번역 입력 — 임의 재난 문장을 KoBART가 글로스로 번역, 실연 동작 사전으로 합성 */}
              <div className="mb-4">
                <div className="flex gap-2">
                  {speech.supported && (
                    <button
                      type="button"
                      onClick={speech.toggle}
                      aria-pressed={speech.listening}
                      title={speech.listening ? '음성 입력 중지' : '음성으로 재난 상황 말하기'}
                      className={`shrink-0 rounded-lg border px-3 py-2 text-sm font-semibold transition-all ${
                        speech.listening
                          ? 'animate-pulse border-red-400/70 bg-red-500/20 text-red-200'
                          : 'border-white/10 bg-space-800 text-slate-300 hover:border-cyan-glow/40 hover:text-cyan-soft'
                      }`}
                    >
                      {speech.listening ? '● 듣는 중' : '🎙 음성'}
                    </button>
                  )}
                  <input
                    type="text"
                    value={speech.interim || aiText}
                    onChange={(e) => setAiText(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && composeText()}
                    placeholder={
                      speech.listening
                        ? '말씀하세요 — 문장이 끝나면 자동으로 수어로 번역합니다'
                        : '재난 문장을 입력하면 AI가 수어로 번역합니다 (예: 오늘 밤 한파주의보가 발효됩니다)'
                    }
                    className={`min-w-0 flex-1 rounded-lg border bg-space-800 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none ${
                      speech.interim
                        ? 'border-cyan-glow/60 italic text-cyan-soft'
                        : 'border-white/10 focus:border-cyan-glow/60'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => composeText()}
                    disabled={aiBusy || !aiText.trim()}
                    className="shrink-0 rounded-lg border border-cyan-glow/50 bg-cyan-glow/10 px-4 py-2 text-sm font-semibold text-cyan-soft transition-all hover:bg-cyan-glow/20 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {aiBusy ? '번역 중…' : 'AI 수어 번역'}
                  </button>
                </div>
                {/* 말하는 중 실시간 글로스 — 번역이 진행 중임을 보여 준다 */}
                {speech.listening && (
                  <div className="mt-2 flex min-h-[28px] flex-wrap items-center gap-1">
                    <span className="mr-1 text-[10.5px] text-slate-500">수어 변환 중</span>
                    {previewGloss.length === 0 ? (
                      <span className="text-[11px] text-slate-600">말씀하시면 단어가 나타납니다…</span>
                    ) : (
                      previewGloss.map((g, i) => (
                        <span
                          key={`${g}-${i}`}
                          className="animate-pop-in rounded bg-cyan-glow/15 px-1.5 py-0.5 text-[11px] text-cyan-soft"
                        >
                          {cleanGloss(g)}
                        </span>
                      ))
                    )}
                  </div>
                )}
                {aiNote && <p className="mt-1.5 text-xs text-amber-300/90">{aiNote}</p>}
                {speech.error && <p className="mt-1.5 text-xs text-red-300/90">{speech.error}</p>}

                {/* 수어 사전 — 단어를 찾아 바로 수어 동작을 본다 */}
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="text"
                    value={dictQuery}
                    onChange={(e) => void searchDict(e.target.value)}
                    placeholder="🔍 수어 사전 — 단어 검색 (예: 지진, 대피, 병원)"
                    className="min-w-0 flex-1 rounded-lg border border-white/10 bg-space-900 px-3 py-1.5 text-xs text-slate-300 placeholder:text-slate-600 focus:border-cyan-glow/50 focus:outline-none"
                  />
                  {dictHits.length > 0 && (
                    <span className="shrink-0 text-[10.5px] text-slate-500">{dictHits.length}건</span>
                  )}
                </div>
                {dictHits.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {dictHits.map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => void playDictWord(g)}
                        className="rounded border border-white/10 bg-space-800 px-2 py-1 text-[11px] text-slate-300 transition-colors hover:border-cyan-glow/50 hover:text-cyan-soft"
                      >
                        {g.replace(/[0-9#:]+$/, '') || g}
                        <span className="ml-0.5 text-slate-600">{(g.match(/[0-9]+$/) ?? [''])[0]}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

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
                        {s.file === '__ai__' ? `✦ AI: ${s.korean_text.slice(0, 10)}…` : `${i + 1}. ${s.korean_text.slice(0, 12)}…`}
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
                  <button
                    type="button"
                    onClick={() => setCaptions((c) => !c)}
                    aria-pressed={captions}
                    title="현재 표현 중인 수어 단어를 자막으로 표시"
                    className={`rounded-md border px-2.5 py-1.5 text-[11px] transition-colors ${
                      captions
                        ? 'border-cyan-glow bg-cyan-glow text-space-950 font-bold'
                        : 'border-white/10 bg-space-900/80 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    자막
                  </button>
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

                {/* 자막 오버레이 — 지금 어느 단어를 표현 중인지 보여 준다.
                    발표에서 "아바타가 팔을 움직인다"와 "무슨 말을 하는 중이다"는 다르다.
                    수어를 모르는 청중에게 이 연결을 보여 주는 게 자막의 역할이다. */}
                {captions && data && (
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-space-900/95 via-space-900/70 to-transparent px-4 pb-3 pt-10">
                    <p className="truncate text-center text-[11px] text-slate-400">
                      {data.korean_text}
                    </p>
                    <p className="mt-1 text-center text-lg font-bold tracking-wide text-cyan-soft text-glow sm:text-xl">
                      {currentGlossText || ' '}
                    </p>
                  </div>
                )}

                {mode === '3d' && !captions && (
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
                <button
                  type="button"
                  onClick={() => {
                    const on = !broadcast
                    setBroadcast(on)
                    if (on) setPlaying(true) // 켜면 바로 방송이 시작돼야 자연스럽다
                  }}
                  aria-pressed={broadcast}
                  title="문장이 끝나면 다음 문장으로 이어 재생 — 무인 재난방송 시연"
                  className={`rounded-lg border px-4 py-2.5 text-sm transition-colors ${
                    broadcast
                      ? 'border-cyan-glow bg-cyan-glow/10 font-semibold text-cyan-soft'
                      : 'border-white/10 text-slate-300 hover:border-cyan-glow/40 hover:text-cyan-soft'
                  }`}
                >
                  {broadcast ? '📡 연속 방송 중' : '📡 연속 방송'}
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

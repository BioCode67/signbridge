// 수어 이용자(농인) 전용 화면 — `#/app`.
//
// 본 사이트는 심사·소개용이라 설명 텍스트가 많다. 정작 당사자가 재난 정보를 받는
// 화면은 정반대여야 한다:
//   - **한국어 텍스트 최소화** — 수어가 모어이고 한국어는 제2언어다. 문해력 편차가 크다.
//   - 시각 신호 중심 — 새 알림은 소리가 아니라 화면 번쩍임으로.
//   - 큰 요소 — 아바타가 화면의 주인공, 버튼은 엄지로 누르는 크기.
//
// 1차 버전은 "받기" 흐름: 재난문자 수신 → 아바타가 수어로 → 큰 자막.
// "말하기"(수어로 질문)는 소개 페이지의 인식 데모로 이동한다(2차에서 이 화면에 통합).
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SignData } from '../sections/sign/signTypes'
import { composeGlosses, type BankIndex } from '../sections/sign/composeLocal'
import { DictSignAgent } from '../agents/dictSignAgent'
import { AVATARS } from '../sections/sign/avatars'
import { categoryKo, type FeedItem } from '../sections/sign/LiveConsole'

const Avatar3D = lazy(() => import('../sections/sign/Avatar3D'))
// 말하기(웹캠 인식)는 MediaPipe 번들이 무거워 탭을 열 때만 불러온다.
const SpeakMode = lazy(() => import('./SpeakMode'))

type Playable = SignData & { gloss_missing?: string[] }

export default function UserApp() {
  const [feed, setFeed] = useState<FeedItem[]>([])
  const [cursor, setCursor] = useState(0)
  const [data, setData] = useState<Playable | null>(null)
  const [frame, setFrame] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(false)
  const [auto, setAuto] = useState(true)
  // 받기(재난문자→수어) / 말하기(내 수어→질문) 두 모드.
  const [tab, setTab] = useState<'watch' | 'speak'>('watch')

  const frameRef = useRef(0)
  const playingRef = useRef(false)
  const rafRef = useRef(0)
  const lastRef = useRef(0)
  useEffect(() => { playingRef.current = playing }, [playing])

  // 번역기 준비물(사전·뱅크)은 한 번만 받는다.
  const dictRef = useRef<DictSignAgent | null>(null)
  const bankRef = useRef<BankIndex | null>(null)
  const cacheRef = useRef(new Map<string, SignData>())

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/feed.json`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setFeed)
      .catch(() => setFeed([]))
  }, [])

  const compose = useCallback(async (text: string): Promise<Playable | null> => {
    if (!dictRef.current) dictRef.current = new DictSignAgent()
    const base = import.meta.env.BASE_URL
    if (!bankRef.current) {
      const res = await fetch(`${base}data/bank.json`)
      if (!res.ok) return null
      bankRef.current = (await res.json()) as BankIndex
    }
    const { gloss } = await dictRef.current.convert(text)
    return composeGlosses(text, gloss, bankRef.current, async (name, entry) => {
      const hit = cacheRef.current.get(name)
      if (hit) return hit
      const res = await fetch(`${base}data/glosses/${entry.file}`)
      if (!res.ok) throw new Error(name)
      const json = (await res.json()) as SignData
      cacheRef.current.set(name, json)
      return json
    })
  }, [])

  // 재난문자 한 건을 수어로 만들어 재생한다. 새 알림은 화면 번쩍임으로 알린다(소리 금지).
  const playItem = useCallback(async (item: FeedItem) => {
    setBusy(true)
    setFlash(true)
    window.setTimeout(() => setFlash(false), 900)
    const composed = await compose(item.text)
    setBusy(false)
    if (!composed) return
    setData(composed)
    frameRef.current = 0
    setFrame(0)
    setPlaying(true)
  }, [compose])

  // 재생 루프.
  useEffect(() => {
    if (!playing || !data) return
    lastRef.current = 0
    const step = (ts: number) => {
      if (!playingRef.current) return
      if (ts - lastRef.current >= 1000 / data.fps) {
        lastRef.current = ts
        const next = frameRef.current + 1
        if (next >= data.num_frames) {
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

  // 자동 수신 — 재생이 끝나면 잠시 뒤 다음 문자를 받는다.
  useEffect(() => {
    if (!auto || playing || busy || feed.length === 0) return
    const t = window.setTimeout(() => {
      setCursor((c) => c + 1)
      void playItem(feed[cursor % feed.length])
    }, 2200)
    return () => window.clearTimeout(t)
  }, [auto, playing, busy, feed, cursor, playItem])

  // 지금 표현 중인 단어(큰 자막).
  const time = data ? frame / data.fps : 0
  const nowGloss = useMemo(() => {
    if (!data) return ''
    return data.gloss_sequence
      .filter((g) => time >= g.start && time <= g.end)
      .map((g) => g.gloss.replace(/[0-9#:]+$/, ''))
      .join(' ')
  }, [data, time])

  const onAnswer = useCallback((text: string) => {
    setTab('watch')
    setAuto(false) // 자동 수신이 답변 재생을 덮지 않게 잠시 멈춘다
    void (async () => {
      const composed = await compose(text)
      if (!composed) return
      setData(composed)
      frameRef.current = 0
      setFrame(0)
      setPlaying(true)
    })()
  }, [compose])

  const item = feed.length ? feed[(cursor - 1 + feed.length) % feed.length] : null

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-space-950">
      {/* 새 알림 번쩍임 — 소리를 못 듣는 사용자를 위한 시각 벨 */}
      <div
        aria-hidden
        className={`pointer-events-none fixed inset-0 z-50 border-[6px] transition-opacity duration-300 ${
          flash ? 'border-amber-400 opacity-100' : 'border-transparent opacity-0'
        }`}
      />

      {/* 상단바 — 최소한만 */}
      <header className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
        <span className="text-lg font-bold text-white">🤟 SignBridge</span>
        {item && (
          <span className="rounded-md bg-amber-400/15 px-2 py-1 text-sm font-bold text-amber-300">
            {categoryKo(item.category)}
          </span>
        )}
        <div className="flex gap-1 rounded-xl border border-white/10 bg-space-900 p-1">
          {([['watch', '📺 받기'], ['speak', '🤟 말하기']] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-pressed={tab === id}
              className={`rounded-lg px-3 py-1.5 text-base font-bold ${
                tab === id ? 'bg-cyan-glow/20 text-cyan-soft' : 'text-slate-400'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setAuto((v) => !v)}
          aria-pressed={auto}
          className={`ml-auto rounded-xl border px-4 py-2 text-base font-bold ${
            auto
              ? 'border-emerald-400/60 bg-emerald-400/15 text-emerald-300'
              : 'border-white/15 bg-space-800 text-slate-300'
          }`}
        >
          {auto ? '📡 받는 중' : '📡 받기'}
        </button>
        <a
          href="#demo"
          onClick={() => { window.location.hash = '' }}
          className="rounded-xl border border-white/15 px-4 py-2 text-base text-slate-300"
        >
          ✕
        </a>
      </header>

      {/* 말하기 — 내 수어를 카메라로 */}
      {tab === 'speak' && (
        <div className="min-h-0 flex-1">
          <Suspense
            fallback={
              <div className="grid h-full place-items-center text-slate-400">
                <span className="animate-pulse text-2xl">카메라 모듈 여는 중…</span>
              </div>
            }
          >
            <SpeakMode onAnswer={onAnswer} />
          </Suspense>
        </div>
      )}

      {/* 아바타 — 화면의 주인공 */}
      {tab === 'watch' && (
      <div className="relative min-h-0 flex-1">
        <Suspense
          fallback={
            <div className="grid h-full place-items-center text-slate-500">
              <span className="animate-pulse text-5xl">🤟</span>
            </div>
          }
        >
          {data ? (
            <Avatar3D data={data} frame={frame} animate modelUrl={AVATARS[0].url} />
          ) : (
            <div className="grid h-full place-items-center">
              <button
                type="button"
                onClick={() => feed.length && void playItem(feed[cursor % feed.length])}
                className="rounded-3xl border-2 border-cyan-glow/60 bg-cyan-glow/10 px-10 py-8 text-2xl font-bold text-cyan-soft"
              >
                ▶ 시작
              </button>
            </div>
          )}
        </Suspense>

        {busy && (
          <div className="absolute inset-x-0 top-4 text-center">
            <span className="rounded-full bg-space-900/90 px-4 py-2 text-base text-cyan-soft">
              수어로 바꾸는 중…
            </span>
          </div>
        )}

        {/* 큰 자막 — 지금 단어 + 원문 */}
        {data && (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-space-950 via-space-950/85 to-transparent px-4 pb-4 pt-16 text-center">
            <p className="text-3xl font-extrabold tracking-wide text-cyan-soft text-glow sm:text-4xl">
              {nowGloss || ' '}
            </p>
            <p className="mx-auto mt-2 max-w-2xl text-sm leading-relaxed text-slate-300 sm:text-base">
              {data.korean_text}
            </p>
          </div>
        )}
      </div>
      )}

      {/* 하단 큰 버튼들 */}
      {tab === 'watch' && (
      <nav className="grid grid-cols-2 gap-2 border-t border-white/10 p-3">
        <button
          type="button"
          disabled={!data || busy}
          onClick={() => {
            frameRef.current = 0
            setFrame(0)
            setPlaying(true)
          }}
          className="rounded-2xl border border-white/15 bg-space-800 py-4 text-xl font-bold text-slate-200 disabled:opacity-40"
        >
          🔁 다시
        </button>
        <button
          type="button"
          disabled={busy || feed.length === 0}
          onClick={() => {
            setCursor((c) => c + 1)
            void playItem(feed[cursor % feed.length])
          }}
          className="rounded-2xl border border-cyan-glow/50 bg-cyan-glow/10 py-4 text-xl font-bold text-cyan-soft disabled:opacity-40"
        >
          ⏭ 다음
        </button>
      </nav>
      )}
    </div>
  )
}

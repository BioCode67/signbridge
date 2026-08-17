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
const PlaceMode = lazy(() => import('./PlaceMode'))

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
  // 재생 속도 — 수어 숙련도에 따라 선호가 다르다(학습자·고령 농인은 느리게).
  const [speed, setSpeed] = useState(1)
  const speedRef = useRef(1)
  useEffect(() => { speedRef.current = speed }, [speed])
  // 받기(재난문자→수어) / 말하기(내 수어→질문) 두 모드.
  const [tab, setTab] = useState<'watch' | 'speak' | 'dict' | 'place'>('watch')
  // 수신 이력 — 놓친 알림을 다시 본다. 세션 내 최근 20건.
  const [history, setHistory] = useState<{ time: string; item: FeedItem }[]>([])
  const [showHistory, setShowHistory] = useState(false)

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
    const { gloss, unmatched } = await dictRef.current.convert(text)
    const composed = await composeGlosses(text, gloss, bankRef.current, async (name, entry) => {
      const hit = cacheRef.current.get(name)
      if (hit) return hit
      const res = await fetch(`${base}data/glosses/${entry.file}`)
      if (!res.ok) throw new Error(name)
      const json = (await res.json()) as SignData
      cacheRef.current.set(name, json)
      return json
    })
    // 번역 단계에서 빠진 낱말(지명 등)도 낱말 카드로 — 동작 사전에 없는 글로스와 합친다.
    if (composed && unmatched?.length) {
      composed.gloss_missing = [...new Set([...(composed.gloss_missing ?? []), ...unmatched])]
    }
    return composed
  }, [])

  // 재난문자 한 건을 수어로 만들어 재생한다. 새 알림은 화면 번쩍임으로 알린다(소리 금지).
  const playItem = useCallback(async (item: FeedItem) => {
    setBusy(true)
    setFlash(true)
    window.setTimeout(() => setFlash(false), 900)
    const composed = await compose(item.text)
    setBusy(false)
    if (!composed) return
    setHistory((h) => [{ time: new Date().toTimeString().slice(0, 5), item }, ...h].slice(0, 20))
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
      if (ts - lastRef.current >= 1000 / data.fps / speedRef.current) {
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
  // 사용자가 탭으로 일시정지한 상태(frame>0에서 멈춤)에서는 기다린다 —
  // 멈춰 놓고 보는데 다음 문장이 덮으면 정지의 의미가 없다.
  useEffect(() => {
    const pausedMidway = !playing && frame > 0
    if (!auto || playing || pausedMidway || busy || feed.length === 0) return
    const t = window.setTimeout(() => {
      setCursor((c) => c + 1)
      void playItem(feed[cursor % feed.length])
    }, 2200)
    return () => window.clearTimeout(t)
  }, [auto, playing, frame, busy, feed, cursor, playItem])

  // 지금 표현 중인 단어(큰 자막).
  const time = data ? frame / data.fps : 0
  const nowGloss = useMemo(() => {
    if (!data) return ''
    return data.gloss_sequence
      .filter((g) => time >= g.start && time <= g.end)
      .map((g) => g.gloss.replace(/[0-9#:]+$/, ''))
      .join(' ')
  }, [data, time])

  // 사전 탭 — bank 색인에서 찾고, 고르면 받기 화면에서 그 단어 수어를 재생한다.
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
    const starts = keys.filter((k) => k.startsWith(query))
    const contains = keys.filter((k) => !k.startsWith(query) && k.includes(query))
    let hits = [...starts, ...contains]
    // 초성 검색 — "ㅈㅈ"처럼 자음만 치면 초성열이 그걸로 시작하는 단어를 찾는다.
    // 한 글자씩 정확히 치기 어려운 사용자(고령·저시력)를 위한 지름길.
    if (hits.length === 0 && /^[ㄱ-ㅎ]+$/.test(query)) {
      const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'
      const chosung = (s: string) =>
        [...s].map((ch) => {
          const c = ch.charCodeAt(0) - 0xac00
          return c >= 0 && c < 11172 ? CHO[Math.floor(c / 588)] : ch
        }).join('')
      hits = keys.filter((k) => chosung(k).startsWith(query))
    }
    setDictHits(hits.slice(0, 18))
  }, [])

  const playDictWord = useCallback(async (gloss: string) => {
    if (!bankRef.current) return
    const base = import.meta.env.BASE_URL
    const composed = await composeGlosses(gloss, [gloss], bankRef.current, async (name, entry) => {
      const hit = cacheRef.current.get(name)
      if (hit) return hit
      const res = await fetch(`${base}data/glosses/${entry.file}`)
      if (!res.ok) throw new Error(name)
      const json = (await res.json()) as SignData
      cacheRef.current.set(name, json)
      return json
    })
    if (!composed) return
    setTab('watch')
    setAuto(false)
    setData({ ...composed, korean_text: gloss.replace(/[0-9#:]+$/, '') })
    frameRef.current = 0
    setFrame(0)
    setPlaying(true)
  }, [])

  const onAnswer = useCallback((text: string, gloss?: string[]) => {
    setTab('watch')
    setAuto(false) // 자동 수신이 답변 재생을 덮지 않게 잠시 멈춘다
    void (async () => {
      // 글로스가 직접 지정된 문구(장소 모드)는 번역을 거치지 않고 바로 합성한다.
      let composed: Playable | null = null
      if (gloss && gloss.length) {
        const base = import.meta.env.BASE_URL
        if (!bankRef.current) {
          const res = await fetch(`${base}data/bank.json`)
          if (res.ok) bankRef.current = (await res.json()) as BankIndex
        }
        if (bankRef.current) {
          composed = await composeGlosses(text, gloss, bankRef.current, async (name, entry) => {
            const hit = cacheRef.current.get(name)
            if (hit) return hit
            const res = await fetch(`${base}data/glosses/${entry.file}`)
            if (!res.ok) throw new Error(name)
            const json = (await res.json()) as SignData
            cacheRef.current.set(name, json)
            return json
          })
        }
      }
      if (!composed) composed = await compose(text)
      if (!composed) {
        // 조용히 실패하면 사용자는 고장으로 느낀다 — 문장이라도 크게 띄운다.
        setData({ korean_text: text, fps: 30, num_frames: 1,
                  gloss_sequence: [], keypoints: { pose: [[]], hand_left: [[]], hand_right: [[]] } })
        setFrame(0); setPlaying(false)
        return
      }
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
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="rounded-md bg-amber-400/15 px-2 py-1 text-sm font-bold text-amber-300"
            title="지나간 알림 보기"
          >
            {categoryKo(item.category)} ▾
          </button>
        )}
        <div className="flex gap-1 rounded-xl border border-white/10 bg-space-900 p-1">
          {([['watch', '📺 받기'], ['speak', '🤟 말하기'], ['place', '🏥 장소'], ['dict', '📖 사전']] as const).map(([id, label]) => (
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

      {/* 사전 — 단어를 찾아 수어를 본다. 찾으면 받기 화면에서 재생한다. */}
      {tab === 'dict' && (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <input
            type="search"
            value={dictQuery}
            onChange={(e) => void searchDict(e.target.value)}
            placeholder="🔍 단어 찾기"
            autoFocus
            className="w-full rounded-2xl border border-white/15 bg-space-900 px-5 py-4 text-xl text-slate-100 placeholder:text-slate-500 focus:border-cyan-glow/60 focus:outline-none"
          />
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {dictHits.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => void playDictWord(g)}
                className="rounded-2xl border border-white/10 bg-space-800 px-3 py-5 text-xl font-bold text-slate-200 transition-colors hover:border-cyan-glow/50 hover:text-cyan-soft"
              >
                {g.replace(/[0-9#:]+$/, '') || g}
              </button>
            ))}
          </div>
          {dictQuery && dictHits.length === 0 && (
            <p className="mt-8 text-center text-lg text-slate-500">😢 없는 단어예요</p>
          )}
        </div>
      )}

      {/* 장소 모드 — 병원·주민센터·택시에서 직원과 함께 쓰는 화면 */}
      {tab === 'place' && (
        <Suspense fallback={<div className="grid flex-1 place-items-center text-slate-400">여는 중…</div>}>
          <PlaceMode onSign={onAnswer} />
        </Suspense>
      )}

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

      {/* 수신 이력 — 놓친 알림 다시 보기 */}
      {showHistory && (
        <div className="absolute inset-x-0 top-14 z-40 max-h-[55%] overflow-y-auto border-b border-white/10 bg-space-950/98 p-3 shadow-2xl">
          {history.length === 0 ? (
            <p className="py-6 text-center text-slate-500">아직 받은 알림이 없어요</p>
          ) : (
            history.map((h, i) => (
              <button
                key={i}
                type="button"
                onClick={() => { setShowHistory(false); setTab('watch'); setAuto(false); void playItem(h.item) }}
                className="mb-2 w-full rounded-xl border border-white/10 bg-space-800 px-3 py-3 text-left"
              >
                <span className="mr-2 rounded bg-amber-400/15 px-1.5 py-0.5 text-xs font-bold text-amber-300">
                  {categoryKo(h.item.category)}
                </span>
                <span className="text-xs text-slate-500">{h.time}</span>
                <p className="mt-1 line-clamp-2 text-sm text-slate-300">{h.item.text}</p>
              </button>
            ))
          )}
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
            <div
              role="button"
              tabIndex={0}
              aria-label={playing ? '일시정지' : '재생'}
              onClick={() => data.num_frames > 1 && setPlaying((v) => !v)}
              onKeyDown={(e) => e.key === ' ' && data.num_frames > 1 && setPlaying((v) => !v)}
              className="h-full w-full cursor-pointer"
            >
              <Avatar3D data={data} frame={frame} animate modelUrl={AVATARS[0].url} />
              {!playing && data.num_frames > 1 && (
                <div className="pointer-events-none absolute inset-0 grid place-items-center">
                  <span className="rounded-full bg-space-900/80 px-8 py-6 text-5xl">▶</span>
                </div>
              )}
            </div>
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

        {/* 재생 진행바 — 문장이 얼마나 남았는지 한눈에 */}
        {data && data.num_frames > 1 && (
          <div className="absolute inset-x-0 top-0 h-1.5 bg-white/5">
            <div
              className="h-full bg-cyan-glow/70 transition-[width] duration-100"
              style={{ width: `${(frame / Math.max(1, data.num_frames - 1)) * 100}%` }}
            />
          </div>
        )}

        {/* 큰 자막 — 지금 단어 + 원문 */}
        {data && (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-space-950 via-space-950/85 to-transparent px-4 pb-4 pt-16 text-center">
            {/* 낱말 카드 — 수어로 표현하지 못한 낱말(주로 지명·기관명)을 큰 글씨로.
                지문자 데이터가 아직 없어 동작으론 못 보여주지만, 정보가 사라지면 안 된다. */}
            {!!data.gloss_missing?.length && (
              <div className="mb-2 flex flex-wrap items-center justify-center gap-2">
                {data.gloss_missing.map((w, i) => (
                  <span
                    key={`${w}-${i}`}
                    className="rounded-xl border-2 border-amber-400/70 bg-amber-400/15 px-3 py-1.5 text-xl font-extrabold text-amber-200"
                  >
                    {w.replace(/[0-9#:]+$/, '') || w}
                  </span>
                ))}
              </div>
            )}
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
      <nav className="grid grid-cols-[1fr_1fr_auto] gap-2 border-t border-white/10 p-3">
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
        <button
          type="button"
          onClick={() => setSpeed((v) => (v === 1 ? 0.6 : v === 0.6 ? 1.4 : 1))}
          title="재생 속도"
          className="rounded-2xl border border-white/15 bg-space-800 px-5 py-4 text-xl font-bold text-slate-200"
        >
          {speed === 1 ? '1×' : speed === 0.6 ? '🐢' : '⚡'}
        </button>
      </nav>
      )}
    </div>
  )
}

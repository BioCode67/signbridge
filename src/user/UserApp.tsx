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
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { RuleDisasterAgent } from '../agents/disasterAgent'
import type { Severity } from '../agents/types'
import { categoryKo, type FeedItem } from '../sections/sign/LiveConsole'
import { guideFor } from './safetyGuides'
import { useSignPlayer } from './useSignPlayer'
import { glossLabel } from '../agents/glossLabel'
import { useOfflineReady } from './useOfflineReady'
import SignStage from './SignStage'

// 심각도 → 색·라벨. 색만으로 구분하지 않도록 라벨을 함께 쓴다(색각 배려).
const SEVERITY_UI: Record<Severity, { label: string; cls: string }> = {
  emergency: { label: '긴급', cls: 'border-red-400 bg-red-500/20 text-red-200' },
  warning: { label: '경보', cls: 'border-orange-400 bg-orange-400/20 text-orange-200' },
  watch: { label: '주의', cls: 'border-amber-300 bg-amber-300/15 text-amber-200' },
  info: { label: '안내', cls: 'border-slate-400 bg-slate-400/15 text-slate-300' },
}
// 문자 원문에서 지역 근사 추출 — 행정단위 접미사가 붙은 첫 낱말.
// 접미사 뒤가 한글이면 낱말 중간이다("철새도래지"의 "철새도" 오인 방지).
// 한 글자 행정단위(도·시·구·동·읍·면)는 앞이 2글자 이상일 때만 지역으로 본다.
const REGION_RE = /([가-힣]{2,6}(?:특별시|광역시|자치시|자치도|시|군|구|도|동|읍|면))(?![가-힣])/

// 말하기(웹캠 인식)는 MediaPipe 번들이 무거워 탭을 열 때만 불러온다.
// 수어로 묻기 — 카메라 → 낱말 → 의도 → 위치 기반 답 → 아바타 수어 + 방향 지도.
const AskMode = lazy(() => import('./AskMode'))
const TalkMode = lazy(() => import('./TalkMode'))

/** 키오스크로 세워 두는 모드 — 주소에 `#/app?kiosk=1`.
 *
 *  관공서·병원 로비에 놓는 기기는 개인 폰과 쓰임이 다르다.
 *   - 처음 오는 사람이 서므로 **대화 화면으로 시작**한다(재난문자 자동 재생이 아니라).
 *   - 소개 페이지로 돌아갈 이유가 없으므로 닫기(✕)를 감춘다.
 *   - 서서 보는 거리라 글씨를 크게 시작한다.
 *  대화 화면은 5분 손대지 않으면 스스로 초기화되므로(앞사람 대화가 남지 않는다)
 *  키오스크에 필요한 나머지는 이미 갖춰져 있다. */
const KIOSK = typeof window !== 'undefined' && /[?&]kiosk=1/.test(window.location.hash)

export default function UserApp() {
  const [feed, setFeed] = useState<FeedItem[]>([])
  const [cursor, setCursor] = useState(0)
  const [flash, setFlash] = useState(false)
  const [auto, setAuto] = useState(true)
  // 수어 재생기 — 번역·합성·프레임 루프를 담은 훅. 대화 화면도 같은 훅을 쓴다.
  const player = useSignPlayer()
  const { data, frame, playing, busy, speed } = player
  // 자막 크기 — 저시력·고령 사용자용. 기기에 기억한다.
  const [fontScale, setFontScale] = useState<0 | 1 | 2>(() => {
    if (KIOSK) return 2 // 서서 보는 거리 — 크게 시작한다
    const saved = Number(localStorage.getItem('sb-font') ?? 1)
    return (saved === 0 || saved === 2 ? saved : 1) as 0 | 1 | 2
  })
  useEffect(() => { localStorage.setItem('sb-font', String(fontScale)) }, [fontScale])
  // 받기(재난문자→수어) · 대화(창구) · 질문(내 수어로 묻기) · 사전.
  // **마지막에 쓴 탭을 기억한다** — 병원에 가는 사람은 앱을 열자마자 대화 화면을
  // 원하지 재난문자를 원하지 않는다. 매번 탭을 찾아 누르게 하는 것은 그 자체로 장벽이다.
  const [tab, setTab] = useState<'watch' | 'speak' | 'dict' | 'place'>(() => {
    if (KIOSK) return 'place'
    const saved = localStorage.getItem('sb-tab')
    return saved === 'place' || saved === 'speak' || saved === 'dict' ? saved : 'watch'
  })
  useEffect(() => { localStorage.setItem('sb-tab', tab) }, [tab])
  // 수신 이력 — 놓친 알림을 다시 본다. 최근 20건, 기기에 남는다(앱을 껐다 켜도 유지).
  const [history, setHistory] = useState<{ time: string; item: FeedItem }[]>(() => {
    try { return JSON.parse(localStorage.getItem('sb-history') ?? '[]') } catch { return [] }
  })
  useEffect(() => { localStorage.setItem('sb-history', JSON.stringify(history)) }, [history])
  const [showHistory, setShowHistory] = useState(false)
  // 창구 대화 중에는 앱 헤더·탭을 접는다(TalkMode가 알려 준다) — 아바타에 자리를 준다.
  const [immersive, setImmersive] = useState(false)
  const onImmersive = useCallback((on: boolean) => setImmersive(on), [])
  // 지금 재생 중인 문자의 요약 배지 — 종류·심각도·지역.
  const [notice, setNotice] = useState<{ category?: string; severity: Severity; region?: string } | null>(null)
  const disasterRef = useRef<RuleDisasterAgent | null>(null)
  // 행동요령 패널 — 재난 종류에 맞는 요령을 문장 단위로 수어로 본다.
  const [showGuide, setShowGuide] = useState(false)
  const guide = guideFor(notice?.category)
  // 오프라인 준비 상태 — 필수 세트는 알아서 받고, 전체는 사용자가 누를 때.
  const offline = useOfflineReady()
  // 홈 화면 설치 — 브라우저가 설치 가능하다고 알려올 때만 버튼을 보인다.
  // 재난 앱은 홈 화면에 있어야 위급할 때 바로 연다.
  const installRef = useRef<{ prompt: () => Promise<unknown> } | null>(null)
  const [canInstall, setCanInstall] = useState(false)
  // 아이폰 사파리에는 설치 프롬프트가 없다(beforeinstallprompt 미지원). 그래서 위 버튼이
  // 영영 나타나지 않고, 아이폰 사용자는 **설치할 수 있다는 사실 자체를 모른다.**
  // 국내 사용자 상당수가 아이폰이라 안내가 없으면 그만큼이 앱을 못 쓰는 셈이다.
  const [iosHint, setIosHint] = useState(() => {
    if (typeof navigator === 'undefined') return false
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent)
    const standalone = (navigator as unknown as { standalone?: boolean }).standalone === true
      || window.matchMedia?.('(display-mode: standalone)').matches
    return ios && !standalone && localStorage.getItem('sb-ios-hint') !== 'off'
  })
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault()
      installRef.current = e as unknown as { prompt: () => Promise<unknown> }
      setCanInstall(true)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/feed.json`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setFeed)
      .catch(() => setFeed([]))
  }, [])

  // 재난문자 한 건을 수어로 만들어 재생한다. 새 알림은 화면 번쩍임으로 알린다(소리 금지).
  const playItem = useCallback(async (item: FeedItem) => {
    setFlash(true)
    // 진동 벨 — 화면을 안 보고 있어도 주머니 속 진동으로 새 알림을 안다.
    // 소리를 못 듣는 사용자에게 진동은 소리의 역할을 한다(미지원 기기는 무시).
    navigator.vibrate?.([300, 120, 300])
    window.setTimeout(() => setFlash(false), 900)
    // 요약 배지 — 종류(피드 분류)·심각도(규칙 판정)·지역(행정단위 근사).
    if (!disasterRef.current) disasterRef.current = new RuleDisasterAgent()
    setNotice({
      category: item.category,
      severity: disasterRef.current.assess({ text: item.text }).severity,
      region: REGION_RE.exec(item.text)?.[1],
    })
    // **재난문자만 학습 모델로.** 모델이 배운 자리가 여기다(글로스 F1 18.7 → 55.8).
    // 창구·자유 입력은 사전이 낫다 — 모델이 못 배운 말투에서 자신 있게 틀린다.
    const composed = await player.play(item.text, undefined, 'disaster')
    if (!composed) return
    setHistory((h) => [{ time: new Date().toTimeString().slice(0, 5), item }, ...h].slice(0, 20))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.play])

  // 자동 수신 — 재생이 끝나면 잠시 뒤 다음 문자를 받는다.
  // 사용자가 탭으로 일시정지한 상태(frame>0에서 멈춤)에서는 기다린다 —
  // 멈춰 놓고 보는데 다음 문장이 덮으면 정지의 의미가 없다.
  useEffect(() => {
    const pausedMidway = !playing && frame > 0
    // **다른 탭에 있으면 멈춘다.** 창구에서 대화하는 동안에도 재난문자를 배경에서
    // 번역·합성하고 있었다 — 보이지도 않는 화면을 위해 조각을 내려받고 프레임을
    // 돌리느라, 정작 사용자가 기다리는 수어가 늦어진다. 돌아오면 이어서 받는다.
    if (tab !== 'watch') return
    if (!auto || playing || pausedMidway || busy || feed.length === 0) return
    const t = window.setTimeout(() => {
      setCursor((c) => c + 1)
      void playItem(feed[cursor % feed.length])
    }, 2200)
    return () => window.clearTimeout(t)
  }, [tab, auto, playing, frame, busy, feed, cursor, playItem])

  // 사전 탭 — bank 색인에서 찾고, 고르면 받기 화면에서 그 단어 수어를 재생한다.
  const [dictQuery, setDictQuery] = useState('')
  const [dictHits, setDictHits] = useState<string[]>([])
  const searchDict = useCallback(async (q: string) => {
    setDictQuery(q)
    const query = q.trim()
    if (!query) { setDictHits([]); return }
    const index = await player.bank()
    if (!index) return
    const keys = Object.keys(index)
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
    // 같은 이름으로 보이는 변이형(병원0·병원1·병원1@)은 하나만 남긴다 —
    // 화면에 똑같은 카드가 넷 뜨면 무엇을 눌러야 하는지 알 수 없다.
    const seen = new Set<string>()
    hits = hits.filter((g) => {
      const label = glossLabel(g)
      if (seen.has(label)) return false
      seen.add(label)
      return true
    })
    setDictHits(hits.slice(0, 18))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.bank])

  const playDictWord = useCallback(async (gloss: string) => {
    setTab('watch')
    setAuto(false)
    setNotice(null)
    // 단어 하나를 그 자체 글로스로 재생한다 — 원문은 번호를 뗀 표제어로 보여준다.
    const composed = await player.play(glossLabel(gloss), [gloss])
    if (composed) player.playData({ ...composed, korean_text: glossLabel(gloss) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.play, player.playData])

  const onAnswer = useCallback((text: string, gloss?: string[], keepNotice?: boolean) => {
    setTab('watch')
    setAuto(false) // 자동 수신이 답변 재생을 덮지 않게 잠시 멈춘다
    if (!keepNotice) setNotice(null) // 행동요령 재생은 배지를 유지한다(요령 버튼 재진입용)
    // 행동요령은 재난 말뭉치와 같은 말투다 — 학습 모델이 배운 자리다.
    void player.play(text, gloss, 'disaster')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.play])

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

      {/* 아이폰 설치 안내 — 한 번 닫으면 다시 띄우지 않는다 */}
      {iosHint && !immersive && (
        <button
          type="button"
          onClick={() => { localStorage.setItem('sb-ios-hint', 'off'); setIosHint(false) }}
          className="shrink-0 border-b border-cyan-glow/30 bg-cyan-glow/10 px-4 py-2 text-left text-sm leading-snug text-cyan-soft"
        >
          📲 <b>아이폰</b>: 아래 <b>공유</b> 버튼 → <b>“홈 화면에 추가”</b>를 누르면
          앱처럼 열리고 회선이 없어도 동작해요. <span className="text-slate-400">(눌러서 닫기)</span>
        </button>
      )}

      {/* 상단바 — 최소한만.
          폰 폭(390px)에서는 제목·탭·버튼이 한 줄에 들어가지 않아 탭 글자가 세로로 깨지고
          '사전'이 화면 밖으로 밀렸다. 좁으면 두 줄(제목 줄 + 탭 줄)로 접는다. */}
      <header className={`flex-col gap-2 border-b border-white/10 px-3 py-2 sm:flex-row sm:items-center sm:gap-3 sm:px-4 sm:py-3 ${
        immersive ? 'hidden lg:flex' : 'flex'
      }`}>
        <div className="flex flex-wrap items-center gap-2 sm:contents">
        <span className="text-lg font-bold text-white">🤟 SignBridge</span>
        {item && (
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="min-h-[44px] shrink-0 whitespace-nowrap rounded-md bg-amber-400/15 px-3 py-2 text-sm font-bold text-amber-300"
            title="지나간 알림 보기"
          >
            {/* 좁은 화면에서는 분류 이름을 접는다 — 여기서 줄바꿈이 일어나면
                버튼들이 세로로 눌려 글자가 한 자씩 쌓인다(실측). */}
            <span className="hidden sm:inline">{categoryKo(item.category)} </span>▾
          </button>
        )}
        <button
          type="button"
          onClick={() => setAuto((v) => !v)}
          aria-pressed={auto}
          className={`ml-auto shrink-0 whitespace-nowrap rounded-xl border px-3 py-2 text-base font-bold sm:px-4 ${
            auto
              ? 'border-emerald-400/60 bg-emerald-400/15 text-emerald-300'
              : 'border-white/15 bg-space-800 text-slate-300'
          }`}
        >
          📡<span className="hidden sm:inline">{auto ? ' 받는 중' : ' 받기'}</span>
        </button>
        {/* 오프라인 준비 — 재난 때는 회선이 먼저 끊긴다. 미리 받아 두면 그때도 번역된다.
            필수 세트는 조용히 자동으로 받고, 전체(아바타·고빈도 1,200종)는 용량을 밝혀
            사용자가 알고 누르게 한다. */}
        <button
          type="button"
          disabled={offline.busy || offline.level === 'full'}
          onClick={offline.prepareFull}
          title="회선이 없어도 쓸 수 있게 미리 받아 둡니다"
          className={`min-h-[44px] shrink-0 whitespace-nowrap rounded-xl border px-3 py-2 text-base font-bold ${
            offline.level === 'full'
              ? 'border-emerald-400/60 bg-emerald-400/15 text-emerald-300'
              : 'border-white/15 bg-space-800 text-slate-300'
          }`}
        >
          {offline.busy ? (
            `📥 ${offline.percent}%`
          ) : offline.level === 'full' ? (
            <>📴<span className="hidden sm:inline"> 준비됨</span></>
          ) : (
            <>📥<span className="hidden sm:inline">{` 오프라인${offline.fullMb ? ` ${offline.fullMb}MB` : ''}`}</span></>
          )}
        </button>
        {canInstall && (
          <button
            type="button"
            onClick={() => {
              void installRef.current?.prompt()
              setCanInstall(false)
            }}
            className="shrink-0 whitespace-nowrap rounded-xl border border-cyan-glow/50 bg-cyan-glow/10 px-3 py-2 text-base font-bold text-cyan-soft"
            title="홈 화면에 설치"
          >
            📲 설치
          </button>
        )}
        {!KIOSK && (
          <a
            href="#demo"
            onClick={() => { window.location.hash = '' }}
            className="shrink-0 rounded-xl border border-white/15 px-3 py-2 text-base text-slate-300 sm:px-4"
          >
            ✕
          </a>
        )}
        </div>
        {/* 탭 — 좁은 화면에서는 두 번째 줄 전체를 차지해 네 칸이 고르게 눌린다 */}
        <div className="grid grid-cols-4 gap-1 rounded-xl border border-white/10 bg-space-900 p-1 sm:flex sm:gap-1">
          {([['watch', '📺 받기'], ['speak', '📹 묻기'], ['place', '💬 대화'], ['dict', '📖 사전']] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-pressed={tab === id}
              className={`whitespace-nowrap rounded-lg px-2 py-2 text-sm font-bold sm:px-3 sm:py-1.5 sm:text-base ${
                tab === id ? 'bg-cyan-glow/20 text-cyan-soft' : 'text-slate-400'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
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
                {glossLabel(g)}
              </button>
            ))}
          </div>
          {dictQuery && dictHits.length === 0 && (
            <p className="mt-8 text-center text-lg text-slate-500">😢 없는 단어예요</p>
          )}
        </div>
      )}

      {/* 대화 모드 — 병원·택시·관공서에서 직원과 말을 주고받는 화면(마이크·소리 포함) */}
      {tab === 'place' && (
        <Suspense fallback={<div className="grid flex-1 place-items-center text-slate-400">여는 중…</div>}>
          <TalkMode onImmersive={onImmersive} />
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
            <AskMode
              notice={feed[cursor]
                ? {
                    text: feed[cursor].text,
                    category: feed[cursor].category,
                    region: REGION_RE.exec(feed[cursor].text)?.[1],
                  }
                : null}
              onImmersive={onImmersive}
            />
          </Suspense>
        </div>
      )}

      {/* 행동요령 — 문장을 누르면 아바타가 수어로 보여준다 */}
      {showGuide && guide && (
        <div className="absolute inset-x-0 bottom-0 top-16 z-40 flex flex-col bg-space-950 p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-2xl font-extrabold text-slate-100">{guide.icon} {guide.name} 행동요령</span>
            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="rounded-xl border border-white/15 px-4 py-2 text-lg text-slate-300"
            >
              ✕
            </button>
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
            {guide.steps.map((s, i) => (
              <button
                key={s}
                type="button"
                onClick={() => { setShowGuide(false); onAnswer(s, undefined, true) }}
                className="flex w-full items-center gap-3 rounded-2xl border border-emerald-400/30 bg-space-800 px-4 py-4 text-left"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-400/20 text-lg font-extrabold text-emerald-300">
                  {i + 1}
                </span>
                <span className="text-lg font-bold leading-snug text-slate-100">{s}</span>
                <span className="ml-auto text-xl">🤟</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-center text-xs text-slate-500">출처: 행정안전부 국민행동요령 요약 · 문장을 누르면 수어로 보여드려요</p>
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

      {/* 아바타 — 화면의 주인공. 대화 화면과 같은 무대(SignStage)를 쓴다. */}
      {tab === 'watch' && (
        <SignStage
          player={player}
          fontScale={fontScale}
          idle={
            <button
              type="button"
              onClick={() => feed.length && void playItem(feed[cursor % feed.length])}
              className="rounded-3xl border-2 border-cyan-glow/60 bg-cyan-glow/10 px-10 py-8 text-2xl font-bold text-cyan-soft"
            >
              ▶ 시작
            </button>
          }
          badges={
            notice && (
              <div className="mb-2 flex flex-wrap items-center justify-center gap-1.5">
                <span className={`rounded-lg border px-2.5 py-1 text-base font-extrabold ${SEVERITY_UI[notice.severity].cls}`}>
                  {SEVERITY_UI[notice.severity].label}
                </span>
                {notice.category && (
                  <span className="rounded-lg border border-cyan-glow/40 bg-cyan-glow/10 px-2.5 py-1 text-base font-bold text-cyan-soft">
                    {categoryKo(notice.category)}
                  </span>
                )}
                {notice.region && (
                  <span className="rounded-lg border border-white/20 bg-space-800 px-2.5 py-1 text-base font-bold text-slate-200">
                    📍 {notice.region}
                  </span>
                )}
                {guide && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setShowGuide(true); setAuto(false); player.setPlaying(false) }}
                    className="rounded-lg border border-emerald-400/50 bg-emerald-400/15 px-2.5 py-1 text-base font-bold text-emerald-300"
                  >
                    📋 행동요령
                  </button>
                )}
              </div>
            )
          }
        />
      )}
      {/* 하단 큰 버튼들 */}
      {tab === 'watch' && (
      <nav className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 border-t border-white/10 p-3">
        <button
          type="button"
          disabled={!data || busy}
          onClick={player.restart}
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
          onClick={() => player.setSpeed(speed === 1 ? 0.6 : speed === 0.6 ? 1.4 : 1)}
          title="재생 속도"
          className="rounded-2xl border border-white/15 bg-space-800 px-5 py-4 text-xl font-bold text-slate-200"
        >
          {speed === 1 ? '1×' : speed === 0.6 ? '🐢' : '⚡'}
        </button>
        <button
          type="button"
          onClick={() => setFontScale((v) => ((v + 1) % 3) as 0 | 1 | 2)}
          title="자막 크기"
          className="rounded-2xl border border-white/15 bg-space-800 px-5 py-4 font-bold text-slate-200"
        >
          <span className={['text-sm', 'text-xl', 'text-2xl'][fontScale]}>가</span>
        </button>
      </nav>
      )}
    </div>
  )
}

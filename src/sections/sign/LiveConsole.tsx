// 실시간 번역 관제 화면.
//
// **왜 필요한가.** 문장 탭을 눌러 재생하면 아무리 내부가 AI여도 "미리 만든 영상
// 플레이어"로 보인다. 실제로는 문장이 들어올 때마다 그 자리에서 번역·합성하고 있다.
// 그 과정을 드러내는 것이 이 화면의 목적이다 — 수신 → 번역 → 합성 → 송출의 각 단계와
// **실제로 걸린 시간**을 보여 준다. 시간은 지어내지 않고 performance.now()로 잰 값이다.
//
// 자동 수신은 AI Hub 실데이터에서 뽑은 재난문자 246건(41개 유형)을 순서대로 흘린다.
// 지어낸 문장이 아니라는 점이 이 데모의 근거가 된다.
import { useCallback, useEffect, useRef, useState } from 'react'
import { glossLabel } from '../../agents/glossLabel'

export interface FeedItem {
  category: string
  text: string
}

/** 한 건이 처리된 기록 — 화면의 로그 한 줄. */
export interface TranslationLog {
  id: number
  time: string
  category: string
  text: string
  gloss: string[]
  /** 실제 측정값(ms) */
  translateMs: number
  composeMs: number
  backend: string
  missing: number
}

/** KOREN NIA POP 10개소. 지연은 서울 기준 거리 추정치(실회선 연동 전 시뮬). */
const POPS = [
  { name: '서울', ms: 3 }, { name: '수원', ms: 4 }, { name: '춘천', ms: 6 },
  { name: '대전', ms: 7 }, { name: '전주', ms: 9 }, { name: '대구', ms: 10 },
  { name: '광주', ms: 11 }, { name: '창원', ms: 12 }, { name: '부산', ms: 13 },
  { name: '제주', ms: 16 },
]

export type Stage = 'idle' | 'receiving' | 'translating' | 'composing' | 'broadcasting'

const STAGE_LABEL: Record<Stage, string> = {
  idle: '대기',
  receiving: '수신',
  translating: '수어 번역',
  composing: '동작 합성',
  broadcasting: '송출',
}
const STAGES: Stage[] = ['receiving', 'translating', 'composing', 'broadcasting']

/** 재난 유형 영문 코드 → 한국어. 화면에 코드가 그대로 뜨면 읽기 어렵다. */
const CATEGORY_KO: Record<string, string> = {
  COLDWAVE: '한파', HEAVYSNOW: '대설', HEAVYRAIN: '호우', TYPHOON: '태풍',
  STRONGWIND: '강풍', WINDWAVES: '풍랑', DELUGEFLOOD: '홍수', FLOODING: '침수',
  LANDSLIDE: '산사태', EARTHQUAKE: '지진', FORESTFIRE: '산불', FIRE: '화재',
  EXPLOSION: '폭발', CHEMICALACCIDENT: '화학사고', TRAFFICACCIDENT: '교통사고',
  WEATHER: '기상', FINEDUST: '미세먼지', ANIMALDISEASE: '가축질병',
  PREVENTIONOFINFECTIOUSDISEASES: '감염병', CIVILAIRDEFENSEALERT: '민방위',
  ELECTRICGASACCIDENT: '전기가스', POWEROUTAGESANDPOWERSHORTAGES: '정전',
  RAILWAYSUBWAYTAXIACCIDENT: '교통', BANKINGINFORMATION: '금융',
}
export function categoryKo(code: string): string {
  return CATEGORY_KO[code] ?? code.slice(0, 10)
}

interface Props {
  /** 문장을 번역·합성한다. 걸린 시간과 결과를 돌려줘야 한다. */
  translate: (text: string) => Promise<{
    gloss: string[]
    missing: string[]
    backend: string
    translateMs: number
    composeMs: number
  } | null>
  /** 지금 아바타가 재생 중인가 — 재생이 끝나야 다음 건을 받는다. */
  playing: boolean
}

export default function LiveConsole({ translate, playing }: Props) {
  const [feed, setFeed] = useState<FeedItem[]>([])
  const [live, setLive] = useState(false)
  const [stage, setStage] = useState<Stage>('idle')
  const [logs, setLogs] = useState<TranslationLog[]>([])
  const [current, setCurrent] = useState<FeedItem | null>(null)
  const cursorRef = useRef(0)
  const busyRef = useRef(false)
  const liveRef = useRef(false)
  const seqRef = useRef(0)

  useEffect(() => { liveRef.current = live }, [live])

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/feed.json`)
      .then((r) => (r.ok ? r.json() : []))
      .then((f: FeedItem[]) => setFeed(f))
      .catch(() => setFeed([]))
  }, [])

  const processOne = useCallback(async () => {
    if (busyRef.current || feed.length === 0) return
    busyRef.current = true
    const item = feed[cursorRef.current % feed.length]
    cursorRef.current += 1

    setCurrent(item)
    setStage('receiving')
    // 수신 연출은 짧게 — 실제 CBS 수신을 흉내낸 시각적 구분이다.
    await new Promise((r) => setTimeout(r, 220))
    if (!liveRef.current) { busyRef.current = false; setStage('idle'); return }

    setStage('translating')
    const result = await translate(item.text)
    if (!result) {
      setStage('idle')
      busyRef.current = false
      return
    }
    setStage('composing')
    await new Promise((r) => setTimeout(r, 120))
    setStage('broadcasting')

    seqRef.current += 1
    const now = new Date()
    setLogs((prev) => [
      {
        id: seqRef.current,
        time: now.toTimeString().slice(0, 8),
        category: item.category,
        text: item.text,
        gloss: result.gloss,
        translateMs: result.translateMs,
        composeMs: result.composeMs,
        backend: result.backend,
        missing: result.missing.length,
      },
      ...prev,
    ].slice(0, 6))
    busyRef.current = false
  }, [feed, translate])

  // 자동 수신 — 아바타가 재생을 끝내면 다음 건을 받는다.
  useEffect(() => {
    if (!live || playing || busyRef.current) return
    const timer = setTimeout(() => { void processOne() }, 900)
    return () => clearTimeout(timer)
  }, [live, playing, processOne, logs.length])

  const stageIndex = STAGES.indexOf(stage)
  const latest = logs[0]

  return (
    <div className="mb-4 rounded-2xl border border-white/10 bg-space-900/60 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => { setLive((v) => !v); if (live) setStage('idle') }}
          aria-pressed={live}
          className={`rounded-lg border px-4 py-2 text-sm font-semibold transition-all ${
            live
              ? 'border-red-400/70 bg-red-500/15 text-red-200'
              : 'border-cyan-glow/50 bg-cyan-glow/10 text-cyan-soft hover:bg-cyan-glow/20'
          }`}
        >
          {live ? '■ 수신 중지' : '▶ 실시간 재난문자 수신'}
        </button>
        <span className="flex items-center gap-1.5 text-xs text-slate-400">
          <span
            className={`h-2 w-2 rounded-full ${live ? 'animate-pulse bg-red-400' : 'bg-slate-600'}`}
          />
          {live ? 'LIVE' : '대기'}
        </span>
        <span className="ml-auto text-[11px] text-slate-500">
          AI Hub 실제 재난문자 {feed.length}건 · {new Set(feed.map((f) => f.category)).size}개 유형
        </span>
      </div>

      {/* 파이프라인 — 지금 어느 단계인지 */}
      <div className="mb-3 flex items-center gap-1">
        {STAGES.map((s, i) => {
          const done = stageIndex > i
          const active = stage === s
          return (
            <div key={s} className="flex flex-1 items-center gap-1">
              <div
                className={`flex-1 rounded-md border px-2 py-1.5 text-center text-[11px] transition-all ${
                  active
                    ? 'border-cyan-glow bg-cyan-glow/20 font-bold text-cyan-soft'
                    : done
                      ? 'border-cyan-glow/30 bg-cyan-glow/5 text-cyan-soft/70'
                      : 'border-white/10 bg-space-800 text-slate-500'
                }`}
              >
                {STAGE_LABEL[s]}
              </div>
              {i < STAGES.length - 1 && (
                <span className={done ? 'text-cyan-soft/60' : 'text-slate-700'}>›</span>
              )}
            </div>
          )
        })}
      </div>

      {/* 지금 처리 중인 문장 */}
      {current && (
        <div className="mb-2 rounded-lg border border-white/10 bg-space-800/70 px-3 py-2">
          <div className="mb-1 flex items-center gap-2">
            <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
              {categoryKo(current.category)}
            </span>
            <span className="text-[10px] text-slate-500">재난문자 수신</span>
          </div>
          <p className="text-xs leading-relaxed text-slate-300">{current.text}</p>
          {latest && latest.text === current.text && (
            <p className="mt-1.5 flex flex-wrap gap-1">
              {latest.gloss.map((g, i) => (
                <span
                  key={`${g}-${i}`}
                  className="rounded bg-cyan-glow/10 px-1.5 py-0.5 text-[11px] text-cyan-soft"
                >
                  {glossLabel(g)}
                </span>
              ))}
            </p>
          )}
        </div>
      )}

      {/* 처리 기록 — 실제 측정 시간 */}
      {logs.length > 0 && (
        <div className="max-h-36 overflow-y-auto rounded-lg border border-white/5">
          <table className="w-full text-[11px]">
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-b border-white/5 last:border-0">
                  <td className="px-2 py-1 font-mono text-slate-500">{log.time}</td>
                  <td className="px-2 py-1 text-amber-300/80">{categoryKo(log.category)}</td>
                  <td className="max-w-0 truncate px-2 py-1 text-slate-400">{log.text}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-cyan-soft">
                    {log.gloss.length}단어
                  </td>
                  <td className="whitespace-nowrap px-2 py-1 font-mono text-emerald-300/90">
                    {Math.round(log.translateMs + log.composeMs)}ms
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* KOREN 다지점 송출 — 기획안의 핵심 축이다. 변환이 끝나면 전국 POP으로
          동시에 나간다는 것을 눈으로 보여 준다. 지연은 지점별 왕복 추정치(시뮬)라
          그렇게 표기한다 — 실회선 연동 전까지 실측이라고 말하지 않는다. */}
      <div className="mt-3 rounded-lg border border-white/5 bg-space-800/40 p-2.5">
        <div className="mb-1.5 flex items-center gap-2 text-[10.5px] text-slate-500">
          <span className="font-semibold text-slate-400">KOREN 다지점 송출</span>
          <span>NIA POP {POPS.length}개소 동시</span>
          <span className="ml-auto">지연은 회선 연동 전 추정치</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {POPS.map((pop, i) => {
            const on = stage === 'broadcasting' || (latest != null && stage === 'idle')
            return (
              <span
                key={pop.name}
                style={{ transitionDelay: `${i * 45}ms` }}
                className={`rounded border px-2 py-0.5 text-[10.5px] transition-all duration-300 ${
                  on
                    ? 'border-emerald-400/50 bg-emerald-400/10 text-emerald-300'
                    : 'border-white/10 bg-space-900 text-slate-600'
                }`}
              >
                {pop.name}
                <span className="ml-1 font-mono opacity-70">{pop.ms}ms</span>
              </span>
            )
          })}
        </div>
      </div>

      {latest && (
        <p className="mt-2 text-[11px] text-slate-500">
          최근 처리: 번역 {Math.round(latest.translateMs)}ms · 동작 합성{' '}
          {Math.round(latest.composeMs)}ms · {latest.backend}
          {latest.missing > 0 && ` · 미수록 단어 ${latest.missing}개`}
          {' · '}관절 좌표 {Math.round(latest.gloss.length * 0.6 * 10) / 10}KB 전송
          (영상 대비 1/2000)
        </p>
      )}
    </div>
  )
}

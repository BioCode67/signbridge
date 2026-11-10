// 이음 — 서류를 수어로 (#/ieum)
//
// 생활 서류 도우미 「농인을 위한 공공·의료 서류 읽기 도우미」의
// 다음 단계를 보여 주는 화면이다. 흐름은 한 줄이다:
//
//     받은 서류 → (Studio 워크플로우) 쉬운 안내 → 수어 아바타
//
// **정직하게 적는다.** 가운데 칸은 Studio를 실시간으로 부른 결과가 아니라, 제출한
// 예시 문서의 **정답표** 값이다. 쉬운 안내 문장도 그 값만 다시 말하도록 미리 써 둔 것이다.
// 오른쪽 수어는 진짜로 이 자리에서 만든다 — 사이트의 번역 사전(DictSignAgent)과
// 동작 사전을 그대로 써서 문장마다 합성한다. 수어가 없는 낱말은 낱말 카드로 남긴다.
//
// 문장을 **하나씩** 이어서 재생한다. 한꺼번에 붙여 번역하면 어순표가 문장 경계를 넘어
// 낱말을 섞을 수 있고, 지금 어느 문장인지 가운데 칸에서 짚어 줄 수도 없다.
import { useCallback, useEffect, useRef, useState } from 'react'
import { glossLabel } from '../agents/glossLabel'
import SignStage from '../user/SignStage'
import { useSignPlayer, type Playable } from '../user/useSignPlayer'
import { IEUM_SAMPLES, STUDIO_URL, toSignText, type IeumSample, type Urgency } from './samples'

const URGENCY_STYLE: Record<Urgency, string> = {
  높음: 'border-rose-400/60 bg-rose-500/15 text-rose-200',
  보통: 'border-amber-400/60 bg-amber-400/15 text-amber-200',
  낮음: 'border-emerald-400/50 bg-emerald-400/10 text-emerald-200',
  '검토 필요': 'border-violet-400/60 bg-violet-500/15 text-violet-200',
}

const STEPS = [
  { name: 'Document Parse', note: '문서 읽기' },
  { name: 'Extract', note: '항목 뽑기' },
  { name: 'Solar', note: '긴급도 판정' },
  { name: '쉬운 안내', note: '쉬운 한국어' },
  { name: '수어 아바타', note: '이 페이지' },
]

function won(n: number | null): string {
  return n === null ? '서류에서 확인 안 됨' : `${n.toLocaleString('ko-KR')}원`
}

function dateKo(iso: string | null): string {
  if (!iso) return '없음'
  const [y, m, d] = iso.split('-').map(Number)
  return `${y}년 ${m}월 ${d}일`
}

/** 문장 사이에 두는 쉼(ms) — 붙여 재생하면 어디서 문장이 끝났는지 알 수 없다. */
const SENTENCE_GAP_MS = 450
/** 동작이 하나도 없는 문장(낱말 카드만)을 띄워 두는 시간(ms). */
const CARD_ONLY_MS = 1800

export default function IeumPage() {
  const player = useSignPlayer()
  const { compose, playData } = player
  const [sample, setSample] = useState<IeumSample>(IEUM_SAMPLES[0])
  /** 문장별 합성 결과 — 고른 문서의 guide와 같은 순서 */
  const [items, setItems] = useState<Playable[] | null>(null)
  const [idx, setIdx] = useState(0)
  /** 끝까지 재생한 문장 수(계측용) */
  const [played, setPlayed] = useState(0)
  const [state, setState] = useState<'loading' | 'playing' | 'done' | 'error'>('loading')

  const itemsRef = useRef<Playable[] | null>(null)
  const idxRef = useRef(0)
  const autoRef = useRef(false)
  const tokenRef = useRef(0)
  const timerRef = useRef(0)

  useEffect(() => {
    const before = document.title
    document.title = '이음 — 서류를 수어로 | SignBridge'
    window.scrollTo(0, 0)
    return () => { document.title = before }
  }, [])

  const startAt = useCallback((list: Playable[], i: number) => {
    window.clearTimeout(timerRef.current)
    idxRef.current = i
    setIdx(i)
    autoRef.current = true
    setState('playing')
    playData(list[i])
  }, [playData])

  // 문서를 고르면 — 문장을 전부 합성해 두고 첫 문장부터 자동 재생한다.
  useEffect(() => {
    const token = ++tokenRef.current
    window.clearTimeout(timerRef.current)
    autoRef.current = false
    itemsRef.current = null
    setItems(null)
    setPlayed(0)
    setIdx(0)
    setState('loading')
    void (async () => {
      const list: Playable[] = []
      for (const sentence of sample.guide) {
        // 창구·일상 말투라 사전 번역기를 쓴다(domain 'everyday') — 학습 모델은 재난문자 전용이다.
        const d = await compose(toSignText(sentence), undefined, 'everyday')
        if (token !== tokenRef.current) return
        list.push(
          d
            ? { ...d, korean_text: sentence }
            : {
                korean_text: sentence, fps: 30, num_frames: 1, gloss_sequence: [],
                keypoints: { pose: [[]], hand_left: [[]], hand_right: [[]] },
              },
        )
      }
      if (token !== tokenRef.current) return
      itemsRef.current = list
      setItems(list)
      if (list.length) startAt(list, 0)
      else setState('error')
    })().catch(() => {
      if (token === tokenRef.current) setState('error')
    })
  }, [sample, compose, startAt])

  // 한 문장이 끝나면 다음 문장으로.
  // 재생기는 끝에서 frame=0·playing=false로 돌아간다. 사용자가 멈춘 것(frame>0)과 구분된다.
  const wasPlaying = useRef(false)
  useEffect(() => {
    const finished = wasPlaying.current && !player.playing && player.frame === 0
    wasPlaying.current = player.playing
    if (!finished || !autoRef.current) return
    const list = itemsRef.current
    if (!list) return
    const cur = idxRef.current
    setPlayed((n) => n + 1)
    if (cur + 1 >= list.length) {
      autoRef.current = false
      setState('done')
      return
    }
    const wait = list[cur].num_frames <= 1 ? CARD_ONLY_MS : SENTENCE_GAP_MS
    timerRef.current = window.setTimeout(() => {
      if (itemsRef.current === list) startAt(list, cur + 1)
    }, wait)
  }, [player.playing, player.frame, startAt])

  useEffect(() => () => window.clearTimeout(timerRef.current), [])

  const replayAll = () => {
    if (!items?.length) return
    setPlayed(0)
    startAt(items, 0)
  }

  const a = sample.answer
  const totalGlosses = items?.reduce((n, d) => n + d.gloss_sequence.length, 0) ?? 0
  const totalFrames = items?.reduce((n, d) => n + (d.num_frames > 1 ? d.num_frames : 0), 0) ?? 0
  const missing = items ? [...new Set(items.flatMap((d) => d.gloss_missing ?? []))] : []
  const signedSentences = items?.filter((d) => d.num_frames > 1).length ?? 0

  return (
    <div
      className="min-h-screen overflow-x-hidden bg-space-950 text-slate-100"
      // 자동 검증용 계측 — 화면만 봐서는 "재생됨"과 "서 있음"을 구분할 수 없다.
      data-ieum-doc={sample.id}
      data-ieum-state={state}
      data-ieum-sentences={items?.length ?? 0}
      data-ieum-signed={signedSentences}
      data-ieum-glosses={totalGlosses}
      data-ieum-frames={totalFrames}
      data-ieum-missing={missing.length}
      data-ieum-played={played}
    >
      <header className="border-b border-white/[0.06] bg-space-900/80">
        <div className="mx-auto flex max-w-[1320px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-400/15 text-lg">🤟</span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold tracking-wide text-amber-300">
                SignBridge · 생활 서류 수어 안내
              </p>
              <h1 className="text-lg font-extrabold leading-tight tracking-tight text-white sm:text-xl">
                이음 — 서류를 수어로
              </h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <a
              href={STUDIO_URL}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-cyan-glow/40 bg-cyan-glow/10 px-3.5 py-1.5 font-semibold text-cyan-soft hover:bg-cyan-glow/20"
            >
              Studio 워크플로우 ↗
            </a>
            <a href="#top" className="rounded-full border border-white/15 px-3.5 py-1.5 text-slate-300 hover:text-white">
              SignBridge 소개
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1320px] px-4 pb-16 pt-5 sm:px-6">
        {/* 한 줄 요약 + 단계 */}
        <p className="text-base font-semibold leading-relaxed text-slate-100 sm:text-lg">
          받은 서류를 올리면 <span className="text-cyan-soft">쉬운 한국어 안내</span>로 바꾸고,
          그 안내를 <span className="text-amber-300">3D 아바타가 수어로</span> 보여 줍니다.
        </p>
        <ol className="mt-3 flex flex-wrap items-stretch gap-x-1.5 gap-y-2" aria-label="처리 단계">
          {STEPS.map((s, i) => (
            <li key={s.name} className="flex items-center gap-1.5">
              <span
                className={`rounded-lg border px-2.5 py-1.5 text-center leading-tight ${
                  i === STEPS.length - 1
                    ? 'border-amber-400/60 bg-amber-400/10'
                    : 'border-white/10 bg-white/[0.03]'
                }`}
              >
                <span className={`block text-xs font-bold sm:text-sm ${i === STEPS.length - 1 ? 'text-amber-200' : 'text-slate-100'}`}>
                  {s.name}
                </span>
                <span className="block text-[10px] text-slate-400 sm:text-[11px]">{s.note}</span>
              </span>
              {i < STEPS.length - 1 && <span className="text-slate-600" aria-hidden>→</span>}
            </li>
          ))}
        </ol>
        <p className="mt-2 text-xs leading-relaxed text-slate-400">
          앞의 네 단계는 Upstage Studio로 만든 문서 이해 워크플로우이고, 마지막 단계가 이 페이지의 시연입니다.
        </p>

        {/* 문서 고르기 */}
        <div className="mt-5 flex flex-wrap gap-2" role="tablist" aria-label="예시 문서 고르기">
          {IEUM_SAMPLES.map((s) => {
            const on = s.id === sample.id
            return (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={on}
                data-ieum-pick={s.id}
                onClick={() => setSample(s)}
                className={`min-h-[44px] rounded-xl border px-3.5 py-2 text-sm font-bold transition-colors ${
                  on
                    ? 'border-cyan-glow/70 bg-cyan-glow/15 text-cyan-soft'
                    : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25'
                }`}
              >
                <span className="mr-1.5" aria-hidden>{s.icon}</span>
                {s.label}
              </button>
            )
          })}
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.05fr)_minmax(0,1.1fr)]">
          {/* ① 받은 서류 */}
          <section className="min-w-0 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-3 sm:p-4" aria-label="받은 서류">
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-200">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-white/10 text-xs">1</span>
              받은 서류
            </h2>
            <p className="mt-1 truncate text-xs text-slate-400">
              {sample.title}{sample.pageNote ? ` · ${sample.pageNote}` : ''}
            </p>
            <div className="mt-3 max-h-[300px] overflow-y-auto rounded-lg border border-white/10 bg-white lg:max-h-[620px]">
              <img
                key={sample.id}
                src={`${import.meta.env.BASE_URL}${sample.image}`}
                alt={`${sample.title} 예시 문서 그림`}
                width={911}
                height={1288}
                className="block h-auto w-full"
              />
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
              시연용 <strong className="text-slate-400">가상 문서</strong>입니다. 기관·인물·번호는 실제와 관계없습니다.
              (예시 {sample.set})
            </p>
          </section>

          {/* ② 워크플로우 결과 */}
          <section className="min-w-0 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-3 sm:p-4" aria-label="워크플로우 결과">
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-200">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-white/10 text-xs">2</span>
              쉬운 안내
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              Upstage Studio 워크플로우가 내는 항목(예시 문서의 정답 기준) — 이 화면에서 Studio를 실시간으로 부르지는 않습니다.
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-400">긴급도</span>
              <span
                data-ieum-urgency={a.urgency}
                className={`rounded-full border-2 px-3 py-1 text-sm font-extrabold ${URGENCY_STYLE[a.urgency]}`}
              >
                {a.urgency}
              </span>
              <span className="min-w-0 text-xs leading-relaxed text-slate-400">{sample.urgencyNote}</span>
            </div>

            <dl className="mt-3 grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
              <dt className="text-slate-500">서류 종류</dt>
              <dd className="break-words font-semibold text-slate-100">{a.doc_type.replace('_', ' · ')}</dd>
              <dt className="text-slate-500">발행 기관</dt>
              <dd className="break-words font-semibold text-slate-100">{a.issuer ?? '없음'}</dd>
              <dt className="text-slate-500">금액</dt>
              <dd className={`font-semibold ${a.amount_krw === null ? 'text-slate-400' : 'text-slate-100'}`}>
                {a.amount_krw === null && a.urgency !== '검토 필요' ? '없음' : won(a.amount_krw)}
              </dd>
              <dt className="text-slate-500">기한</dt>
              <dd className={`font-semibold ${a.due_date ? 'text-amber-200' : 'text-slate-400'}`}>{dateKo(a.due_date)}</dd>
              <dt className="text-slate-500">문의처</dt>
              <dd className="font-semibold text-slate-100">{a.contact ?? '없음'}</dd>
              <dt className="text-slate-500">약 이름</dt>
              <dd className="break-words font-semibold text-slate-100">
                {a.medication_names.length ? a.medication_names.join(', ') : <span className="text-slate-400">없음</span>}
              </dd>
            </dl>

            <h3 className="mt-4 text-xs font-bold tracking-wide text-cyan-soft">쉬운 안내 문장</h3>
            <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
              위 항목만 다시 말하도록 미리 써 둔 문장입니다. 누르면 그 문장부터 수어로 봅니다.
            </p>
            <ol className="mt-2 space-y-1.5">
              {sample.guide.map((g, i) => {
                const on = !!items && i === idx && state !== 'loading'
                return (
                  <li key={g}>
                    <button
                      type="button"
                      disabled={!items}
                      onClick={() => items && startAt(items, i)}
                      aria-current={on ? 'true' : undefined}
                      className={`flex w-full items-start gap-2 rounded-xl border px-3 py-2.5 text-left text-base font-semibold leading-snug transition-colors ${
                        on
                          ? 'border-cyan-glow/60 bg-cyan-glow/10 text-white'
                          : 'border-white/[0.06] bg-white/[0.02] text-slate-200 hover:border-white/20'
                      }`}
                    >
                      <span className={`mt-0.5 shrink-0 text-xs ${on ? 'text-cyan-soft' : 'text-slate-500'}`}>{i + 1}</span>
                      <span className="min-w-0 break-words">{g}</span>
                    </button>
                  </li>
                )
              })}
            </ol>
          </section>

          {/* ③ 수어 아바타 */}
          <section className="min-w-0 rounded-2xl border border-amber-400/25 bg-white/[0.02] p-3 sm:p-4" aria-label="수어 아바타">
            <div className="flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-bold text-slate-200">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-amber-400/20 text-xs text-amber-200">3</span>
                수어 아바타
              </h2>
              <button
                type="button"
                onClick={replayAll}
                disabled={!items}
                data-ieum-replay
                className="min-h-[40px] rounded-lg border border-white/15 px-3 py-1.5 text-sm font-bold text-slate-200 hover:border-cyan-glow/50 disabled:opacity-40"
              >
                🔁 처음부터 다시
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-400" aria-live="polite">
              {state === 'loading' && '수어로 바꾸는 중…'}
              {state === 'playing' && items && `${idx + 1} / ${items.length} 문장 재생 중`}
              {state === 'done' && items && `${items.length}문장 재생 끝`}
              {state === 'error' && '수어 사전을 불러오지 못했습니다. 새로 고침해 주세요.'}
            </p>

            <div className="mt-2 flex h-[440px] flex-col overflow-hidden rounded-xl border border-white/10 bg-space-900 sm:h-[480px]">
              <SignStage
                player={player}
                compact
                idle={<span className="animate-pulse text-5xl">🤟</span>}
              />
            </div>

            <h3 className="mt-3 text-xs font-bold tracking-wide text-cyan-soft">수어 낱말 순서(글로스)</h3>
            <ol className="mt-1.5 space-y-1.5">
              {(items ?? []).map((d, i) => (
                <li
                  key={`${sample.id}-${i}`}
                  className={`flex flex-wrap items-center gap-1 rounded-lg px-2 py-1.5 ${
                    i === idx && state === 'playing' ? 'bg-cyan-glow/10' : ''
                  }`}
                >
                  <span className="mr-1 text-xs text-slate-500">{i + 1}</span>
                  {d.gloss_sequence.map((g, k) => {
                    const now = i === idx && player.playing && player.time >= g.start && player.time <= g.end
                    return (
                      <span
                        key={`${g.gloss}-${k}`}
                        className={`rounded-md px-1.5 py-0.5 text-sm font-bold ${
                          now ? 'bg-cyan-glow/30 text-cyan-soft' : 'bg-white/[0.06] text-slate-200'
                        }`}
                      >
                        {glossLabel(g.gloss)}
                      </span>
                    )
                  })}
                  {(d.gloss_missing ?? []).map((w) => (
                    <span
                      key={`m-${w}`}
                      title="수어 동작이 없어 글자로 보여 주는 낱말"
                      className="rounded-md border border-amber-400/70 bg-amber-400/15 px-1.5 py-0.5 text-sm font-extrabold text-amber-200"
                    >
                      {w}
                    </span>
                  ))}
                  {!d.gloss_sequence.length && !(d.gloss_missing ?? []).length && (
                    <span className="text-xs text-slate-500">수어로 내지 못한 문장</span>
                  )}
                </li>
              ))}
            </ol>
            {items && (
              <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                수어 낱말 {totalGlosses}개를 이었습니다.{' '}
                {missing.length > 0 ? (
                  <>
                    <span className="font-bold text-amber-300">노란 낱말 {missing.length}개</span>
                    ({missing.join(' · ')})는 수어 동작이 없어 글자 카드로 보여 줍니다 — 기관 이름 같은 고유명사가 대부분입니다.
                  </>
                ) : (
                  '수어가 없어 글자로 보여 준 낱말은 없습니다.'
                )}
              </p>
            )}
          </section>
        </div>

        {/* 왜 필요한가 + 현재 상태 */}
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
            <h2 className="text-sm font-bold text-slate-100">왜 필요한가</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">
              농인의 제1언어는 한국수어이고, 한국어 문서는 제2언어입니다. 병원 영수증·복약안내문·고지서·통지서는
              행정 용어와 긴 문장으로 쓰여 있어, 무엇을 언제까지 해야 하는지 놓치기 쉽습니다.
              이음은 서류에서 <strong className="text-slate-100">돈·기한·문의처·약 이름·긴급도</strong>만 뽑아
              쉬운 한국어로 바꾸고, 그 안내를 다시 수어로 잇습니다.
            </p>
          </section>
          <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
            <h2 className="text-sm font-bold text-slate-100">지금 어디까지 됐나</h2>
            <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-slate-300">
              <li>
                <span className="mr-2 rounded bg-emerald-400/15 px-1.5 py-0.5 text-xs font-bold text-emerald-300">완료</span>
                Upstage Studio 문서 이해 워크플로우 — 게시 완료{' '}
                <a href={STUDIO_URL} target="_blank" rel="noreferrer" className="text-cyan-soft underline underline-offset-2">
                  라이브러리에서 보기
                </a>
              </li>
              <li>
                <span className="mr-2 rounded bg-cyan-glow/15 px-1.5 py-0.5 text-xs font-bold text-cyan-soft">시연</span>
                문서 안내문 → 수어 아바타 연결 — 이 페이지(예시 문서 6건, 항목과 문장은 미리 준비한 결과, 수어는 이 자리에서 합성)
              </li>
              <li>
                <span className="mr-2 rounded bg-white/10 px-1.5 py-0.5 text-xs font-bold text-slate-300">개발 중</span>
                실시간 업로드 연동 — 올린 서류가 워크플로우를 거쳐 바로 수어로 나오는 연결
              </li>
            </ul>
            <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
              수어 동작은 SignBridge의 동작 사전(농인 수어자 영상에서 만든 낱말 단위 동작)을 이어 붙인 것입니다.
              어순과 자연스러움은 아직 농인 당사자 평가를 받지 않았습니다.
            </p>
          </section>
        </div>
      </main>
    </div>
  )
}

// 수어로 묻기 — **영상통화처럼**.
//
// 지금까지 이 앱에서 농인은 정보를 *받기만* 했다. 재난문자를 수어로 보고,
// 창구 직원의 말을 수어로 봤다. 정작 급할 때 필요한 것은 **묻는 쪽**이다 —
// "대피소 어디예요?"는 들을 수 있는 사람이라면 지나가는 사람에게 물어 3초에
// 해결하는 일이고, 농인에게는 그 3초가 통째로 막혀 있다.
//
// 그래서 이 화면은 사람에게 묻는 대신 **앱에 묻는다**:
//
//     카메라 앞에서 수어 → 낱말 인식 → 의도 파악 → 위치로 답 생성
//                                        → 아바타가 수어로 답 + 방향 지도
//
// 화면 문법을 영상통화에 맞춘 이유가 있다. 농인에게 영상통화는 **이미 배운
// 대화 방식**이다(수어 통역 서비스가 그 형태다). 새 사용법을 가르치지 않아도
// "카메라 보고 수어하면 상대가 수어로 답한다"가 바로 통한다. 그래서
//   - 묻는 동안에는 **카메라가 주인공**(내 손이 잘 잡히는지 봐야 한다),
//   - 답하는 동안에는 **아바타가 주인공**이고 카메라는 구석으로 작아진다.
//
// **오프라인에서 동작한다.** 인식(ONNX)·번역(사전)·합성(조각)·장소 목록이 모두
// 기기 안에 있다. 재난 때 통신이 끊겨도 이 화면은 그대로 된다 — 정작 그때가
// 대피소를 물어야 하는 때다.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { glossLabel } from '../agents/glossLabel'
import { useHolistic } from '../recognition/useHolistic'
import { useRecognizer } from '../recognition/useRecognizer'
import type { LandmarkFrame } from '../recognition/landmarks'
import RecognizedWords from './RecognizedWords'
import SignStage from './SignStage'
import { useSignPlayer } from './useSignPlayer'
import { detectIntent, intentKo, type Intent } from './askIntent'
import {
  KIND_KO, answerHeadline, answerSentence, loadNearby, nearest,
  roundDistance, type NearbyData, type PlaceKind, type Ranked,
} from './nearby'
import { guideFor } from './safetyGuides'
import { loadMyInfo } from './myInfo'
import { useSpeechOutput } from '../hooks/useSpeechOutput'

const DirectionMap = lazy(() => import('./DirectionMap'))
const SosScreen = lazy(() => import('./SosScreen'))

interface Props {
  /** 지금 재생 중인 재난 정보 — "지금 무슨 일?"의 답이 된다 */
  notice: { text: string; category?: string; region?: string } | null
  /** 이 화면에 있는 동안 앱 헤더·탭을 접는다(아바타·카메라에 자리를 준다) */
  onImmersive?(on: boolean): void
}

type Phase = 'idle' | 'asking' | 'answering'

interface Answer {
  intent: Intent
  /** 화면에 크게 띄울 한 줄(사람이 읽는 문장, 고유명사 포함) */
  headline: string
  /** 아바타가 수어로 낼 문장(사전에 있는 낱말로만) */
  sign: string
  target?: Ranked
  others?: Ranked[]
  /** 이어서 볼 문장들 — 행동요령 여러 줄, 재난문자 원문 */
  steps?: string[]
  /** 목록·위치가 없어 답할 수 없을 때의 안내 */
  problem?: string
}

export default function AskMode({ notice, onImmersive }: Props) {
  const pushFrameRef = useRef<(f: Float32Array | null) => void>(() => {})
  const onFrame = useCallback((_f: LandmarkFrame, features: Float32Array | null) => {
    pushFrameRef.current(features)
  }, [])

  const holistic = useHolistic({ onFrame })
  const { videoRef, overlayRef, status, error, start, stop } = holistic
  const running = status === 'running'
  const rec = useRecognizer(running)
  useEffect(() => { pushFrameRef.current = rec.pushFrame }, [rec.pushFrame])

  const player = useSignPlayer()
  const [phase, setPhase] = useState<Phase>('idle')
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [nearby, setNearby] = useState<NearbyData | null>(null)
  const [coords, setCoords] = useState<{ lat: number; lon: number; acc: number } | null>(null)
  const [locating, setLocating] = useState(false)
  // '도와주세요'를 수어로 하면 곧바로 긴급 화면 — 위급할 때 버튼을 찾게 하지 않는다.
  const [sos, setSos] = useState(false)
  const tts = useSpeechOutput()

  useEffect(() => { onImmersive?.(true); return () => onImmersive?.(false) }, [onImmersive])

  // 장소 목록은 화면에 들어오자마자 받아 둔다 — 물어본 뒤에 받으면 그만큼 늦다.
  useEffect(() => { void loadNearby(import.meta.env.BASE_URL).then(setNearby) }, [])

  // 위치도 미리 잡아 둔다. GPS는 처음 잡는 데 몇 초가 걸려서, 질문이 끝난 뒤에
  // 시작하면 답이 그만큼 늦어진다. **묻는 동안 뒤에서 잡는다.**
  const locate = useCallback(() => {
    if (!navigator.geolocation) return
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setCoords({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy })
        setLocating(false)
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    )
  }, [])

  const beginAsk = useCallback(() => {
    setPhase('asking')
    setAnswer(null)
    rec.clearTranscript()
    locate()
    void start()
  }, [rec, locate, start])

  useEffect(() => () => stop(), [stop])

  // ── 답 만들기 ─────────────────────────────────────────────
  const makeAnswer = useCallback((intent: Intent): Answer => {
    if (intent.kind === 'help') {
      return { intent, headline: '도와주세요', sign: '돕다 부탁' }
    }
    if (intent.kind === 'whatsup') {
      if (!notice) {
        return {
          intent, headline: '지금 들어온 재난 정보가 없어요',
          sign: '지금 소식 없다', problem: 'no-notice',
        }
      }
      // **문자 원문을 통째로 수어로 내지 않는다.** 재난문자는 길고(평균 두세 문장)
      // 문의 답으로는 너무 무겁다. 먼저 한 줄로 짧게 답하고, 원문 전체는 화면에
      // 띄운 뒤 '전체 수어로 보기'로 넘긴다 — 급할 때 필요한 건 요점이다.
      const g = guideFor(notice.category)
      const what = g?.name ?? notice.category ?? '재난'
      const where = notice.region ? `${notice.region} ` : ''
      return {
        intent,
        headline: notice.text,
        sign: `지금 ${where}${what} 조심하세요`,
        steps: [notice.text],
      }
    }
    if (intent.kind === 'howto') {
      const g = guideFor(notice?.category)
      if (!g || g.steps.length === 0) {
        return { intent, headline: '행동요령이 없어요', sign: '방법 없다', problem: 'no-guide' }
      }
      // 요령은 한 줄로 끝나지 않는다 — 첫 줄을 수어로 내고 나머지는 눌러서 이어 본다.
      return { intent, headline: g.steps[0], sign: g.steps[0], steps: g.steps }
    }
    // 장소 질문
    const kind: PlaceKind = intent.place
    const ko = KIND_KO[kind]
    if (!nearby) {
      return {
        intent, headline: `${ko.label} 목록이 아직 없어요`,
        sign: `${ko.gloss} 없다`, problem: 'no-data',
      }
    }
    if (!coords) {
      return {
        intent, headline: '위치를 켜 주세요',
        sign: '위치 필요', problem: 'no-location',
      }
    }
    const list = nearest(nearby.places, coords.lat, coords.lon, kind, 3)
    if (list.length === 0) {
      return {
        intent, headline: `가까운 ${ko.label}을 찾지 못했어요`,
        sign: `${ko.gloss} 없다`, problem: 'none-found',
      }
    }
    const t = list[0]
    return { intent, headline: answerHeadline(t), sign: answerSentence(t), target: t, others: list }
  }, [nearby, coords, notice])

  /** 의도 하나로 곧장 답한다 — 예시 버튼과 수어 인식이 같은 길을 쓴다. */
  const answerNow = useCallback(async (intent: Intent) => {
    locate()
    const a = makeAnswer(intent)
    setAnswer(a)
    setPhase('answering')
    await player.play(a.sign)
  }, [makeAnswer, player, locate])

  const respond = useCallback(async () => {
    const got = detectIntent(rec.transcript, rec.transcriptAlts)
    if (!got) {
      setAnswer({
        intent: { kind: 'whatsup' },
        headline: '무슨 말인지 모르겠어요. 다시 해 주세요',
        sign: '다시 부탁',
        problem: 'no-intent',
      })
      setPhase('answering')
      void player.play('다시 부탁')
      return
    }
    if (got.intent.kind === 'help') { setSos(true); return }
    const a = makeAnswer(got.intent)
    setAnswer(a)
    setPhase('answering')
    await player.play(a.sign)
  }, [rec.transcript, rec.transcriptAlts, makeAnswer, player])

  // 위치가 늦게 잡혀 "위치를 켜 주세요"로 답해 버린 경우, 좌표가 들어오면 **스스로
  // 고쳐 다시 답한다.** 사용자가 같은 질문을 두 번 하게 만들지 않는다.
  useEffect(() => {
    if (phase !== 'answering' || !answer || answer.problem !== 'no-location' || !coords) return
    const a = makeAnswer(answer.intent)
    if (a.problem === 'no-location') return
    setAnswer(a)
    void player.play(a.sign)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coords, phase, answer?.problem])

  const intentPreview = useMemo(
    () => detectIntent(rec.transcript, rec.transcriptAlts),
    [rec.transcript, rec.transcriptAlts],
  )

  // **손을 내리면 알아서 답한다.**
  //
  // 버튼을 눌러야 답이 나오면 그건 대화가 아니라 조작이다. 사람에게 물을 때는
  // 수어를 마치면 상대가 답하지, "다 했어요" 버튼을 누르지 않는다. 그래서
  // 뜻이 확실하고(1순위 낱말끼리 맞아 점수 1.8 이상) 잠시 손이 멎으면 스스로 답한다.
  //
  // 확실할 때만 그런다. 애매한 판정으로 먼저 답해 버리면 사용자는 문장을 끝내지도
  // 못한 채 엉뚱한 답을 보게 된다 — 그때는 '답 받기'를 직접 누르게 둔다.
  const AUTO_SCORE = 1.8
  const AUTO_WAIT = 1600
  const respondRef = useRef<() => void>(() => {})
  const [autoIn, setAutoIn] = useState(false)
  useEffect(() => {
    if (phase !== 'asking' || !intentPreview || intentPreview.score < AUTO_SCORE) {
      setAutoIn(false)
      return
    }
    setAutoIn(true)
    // 낱말이 하나라도 더 들어오면 이 효과가 다시 돌아 타이머가 처음부터 간다 —
    // 문장을 이어 가는 동안에는 답하지 않는다는 뜻이다.
    const t = window.setTimeout(() => { setAutoIn(false); respondRef.current() }, AUTO_WAIT)
    return () => window.clearTimeout(t)
  }, [phase, intentPreview?.score, rec.transcript.length])
  useEffect(() => { respondRef.current = () => void respond() }, [respond])
  const confident = rec.current !== null && rec.current.confidence >= 0.5

  if (sos) {
    return (
      <Suspense fallback={<div className="grid flex-1 place-items-center text-slate-400">여는 중…</div>}>
        <SosScreen
          myInfo={loadMyInfo()}
          coords={coords}
          locating={locating}
          locError=""
          onLocate={locate}
          onSpeak={tts.speak}
          onClose={() => setSos(false)}
        />
      </Suspense>
    )
  }

  // ── 시작 화면 ─────────────────────────────────────────────
  if (phase === 'idle') {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 p-6 text-center">
        <button
          type="button"
          onClick={beginAsk}
          className="grid h-44 w-44 place-items-center rounded-full bg-cyan-glow/20 text-7xl ring-4 ring-cyan-glow/40 active:scale-95"
          aria-label="수어로 묻기"
        >
          📹
        </button>
        <p className="text-3xl font-extrabold text-slate-100">수어로 물어보세요</p>
        {/* 예시는 **누를 수 있게** 둔다.
            수어를 아직 잘 못 하는 사람(중도 실청·학습 중), 손을 다친 사람,
            카메라를 켤 수 없는 자리(어두운 곳·사람이 많은 곳)에도 길이 있어야 한다.
            같은 답이 같은 방식으로 나오므로 배우는 데도 도움이 된다. */}
        <div className="flex flex-wrap justify-center gap-2">
          {(['shelter', 'hospital', 'pharmacy', 'toilet'] as PlaceKind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => void answerNow({ kind: 'where', place: k })}
              className="min-h-[48px] rounded-full border border-white/15 bg-space-800 px-4 py-2 text-lg font-bold text-slate-200 active:scale-95"
            >
              {KIND_KO[k].icon} {KIND_KO[k].label} 어디?
            </button>
          ))}
        </div>
        <p className="max-w-sm text-base leading-relaxed text-slate-500">
          카메라 영상은 이 기기 밖으로 나가지 않아요.
          {nearby && !nearby.official && (
            <><br />장소 목록은 참고용이에요 ({nearby.source})</>
          )}
        </p>
      </div>
    )
  }

  // ── 묻는 중 / 답하는 중 ───────────────────────────────────
  const asking = phase === 'asking'

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* 아바타 — 답할 때 주인공 */}
      {!asking && (
        <div className="flex min-h-0 flex-1 flex-col">
          <SignStage player={player} compact fontScale={2} />
        </div>
      )}

      {/* 카메라 — 물을 때는 전체, 답할 때는 구석으로 */}
      <div
        className={asking
          ? 'relative min-h-0 flex-1 overflow-hidden bg-black'
          : 'absolute right-3 top-3 z-20 h-28 w-20 overflow-hidden rounded-2xl border-2 border-white/25 bg-black'}
      >
        <video ref={videoRef} playsInline muted
          className="absolute inset-0 h-full w-full -scale-x-100 object-cover opacity-90" />
        <canvas ref={overlayRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />

        {asking && status === 'loading' && (
          <div className="absolute inset-0 grid place-items-center bg-space-950/80">
            <span className="animate-pulse text-2xl text-slate-300">카메라 준비 중…</span>
          </div>
        )}
        {asking && error && (
          <div className="absolute inset-0 grid place-items-center bg-space-950/90 p-6 text-center">
            <p className="text-lg text-red-300">{error}</p>
          </div>
        )}
        {asking && rec.modelStatus === 'loading' && running && (
          <div className="absolute inset-x-0 top-4 text-center">
            <span className="rounded-full bg-space-900/90 px-4 py-2 text-base text-cyan-soft">
              인식 모델 내려받는 중{rec.loadPct != null ? ` ${rec.loadPct}%` : '…'} (최초 1회)
            </span>
          </div>
        )}

        {asking && running && (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 to-transparent px-3 pb-3 pt-12 text-center">
            <p className={`text-4xl font-extrabold ${confident ? 'text-cyan-soft text-glow' : 'text-slate-600'}`}>
              {confident && rec.current ? glossLabel(rec.current.label) : '…'}
            </p>
            <RecognizedWords
              words={rec.transcript} alts={rec.transcriptAlts} onReplace={rec.replaceWord} />
            {/* 무엇으로 알아들었는지 **묻는 동안** 보여준다 — 틀렸으면 지금 고쳐야 한다 */}
            {intentPreview && (
              <p className={`mt-2 rounded-full px-4 py-1.5 text-lg font-bold ${
                autoIn ? 'bg-emerald-400/30 text-emerald-200' : 'bg-emerald-400/15 text-emerald-300'}`}>
                “{intentKo(intentPreview.intent)}”
                {autoIn ? ' — 곧 답할게요' : '로 알아들었어요'}
              </p>
            )}
          </div>
        )}
      </div>

      {/* 답 — 자막 + 방향 지도 */}
      {!asking && answer && (
        <div className="max-h-[52%] shrink-0 overflow-y-auto border-t border-white/10 bg-space-900 px-4 py-3">
          <p className="text-center text-2xl font-extrabold leading-snug text-slate-50">
            {answer.headline}
          </p>
          <p className="mt-1 text-center text-base text-slate-500">
            “{intentKo(answer.intent)}”로 알아들었어요
          </p>

          {answer.target && (
            <>
              <Suspense fallback={<div className="h-40" />}>
                <DirectionMap target={answer.target} others={answer.others}
                  accuracy={coords?.acc} />
              </Suspense>
              {answer.target.addr && (
                <p className="text-center text-base text-slate-400">{answer.target.addr}</p>
              )}
              {/* 다른 후보 — 첫 번째가 막혔거나 문이 닫혔을 수 있다 */}
              {(answer.others?.length ?? 0) > 1 && (
                <div className="mt-2 flex flex-wrap justify-center gap-2">
                  {answer.others!.slice(1).map((o) => (
                    <button key={o.name} type="button"
                      onClick={() => {
                        setAnswer({ ...answer, target: o, headline: answerHeadline(o) })
                        void player.play(answerSentence(o))
                      }}
                      className="rounded-xl border border-white/15 px-3 py-2 text-base text-slate-300">
                      {o.name} · {roundDistance(o.distance).text}
                    </button>
                  ))}
                </div>
              )}
              {/* 골목까지 필요하면 기기 지도로 — 통신이 될 때만 열린다 */}
              <a
                href={`https://map.kakao.com/link/to/${encodeURIComponent(answer.target.name)},${answer.target.lat},${answer.target.lon}`}
                target="_blank" rel="noreferrer"
                className="mt-3 block rounded-2xl border border-white/15 py-3 text-center text-lg font-bold text-slate-200"
              >
                🗺 지도 앱으로 열기
              </a>
            </>
          )}

          {/* 이어지는 문장 — 누르면 그 줄을 수어로 본다 */}
          {(answer.steps?.length ?? 0) > 0 && (
            <div className="mt-3 space-y-2">
              {answer.steps!.map((st, i) => (
                <button key={i} type="button"
                  onClick={() => void player.play(st)}
                  className="flex w-full items-start gap-3 rounded-2xl border border-emerald-400/30 bg-space-800 px-4 py-3 text-left">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-400/20 text-base font-extrabold text-emerald-300">
                    {i + 1}
                  </span>
                  <span className="text-lg font-bold leading-snug text-slate-100">{st}</span>
                </button>
              ))}
            </div>
          )}

          {answer.problem === 'no-location' && (
            <button type="button" onClick={locate}
              className="mt-3 w-full rounded-2xl border border-cyan-glow/40 bg-cyan-glow/10 py-4 text-xl font-bold text-cyan-soft">
              {locating ? '📍 위치 찾는 중…' : '📍 위치 켜기'}
            </button>
          )}

          {nearby && !nearby.official && answer.target && (
            // 대피소는 특히, 목록의 출처를 숨기면 안 된다.
            <p className="mt-3 text-center text-sm leading-relaxed text-amber-300/80">
              ⚠️ 공식 지정 대피소 목록이 아니에요 · 출처 {nearby.source}
            </p>
          )}
        </div>
      )}

      {/* 아래 버튼 — 항상 같은 자리, 엄지로 닿는 크기 */}
      <nav className="grid shrink-0 grid-cols-2 gap-2 border-t border-white/10 p-3">
        {asking ? (
          <>
            <button type="button" disabled={rec.transcript.length === 0}
              onClick={rec.clearTranscript}
              className="min-h-[60px] rounded-2xl border border-white/15 bg-space-800 text-xl font-bold text-slate-200 disabled:opacity-40">
              🗑 지우기
            </button>
            <button type="button" disabled={rec.transcript.length === 0}
              onClick={() => void respond()}
              className="min-h-[60px] rounded-2xl border border-emerald-400/50 bg-emerald-400/15 text-xl font-bold text-emerald-300 disabled:opacity-40">
              💬 답 받기
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => player.restart()}
              className="min-h-[60px] rounded-2xl border border-white/15 bg-space-800 text-xl font-bold text-slate-200">
              ↻ 다시 보기
            </button>
            <button type="button" onClick={beginAsk}
              className="min-h-[60px] rounded-2xl border border-cyan-glow/50 bg-cyan-glow/15 text-xl font-bold text-cyan-soft">
              📹 또 묻기
            </button>
          </>
        )}
      </nav>
    </div>
  )
}

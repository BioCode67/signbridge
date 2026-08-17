// 대화 모드 — 병원·택시·관공서 창구에서 **폰 하나로 대화가 왕복하는** 화면.
//
// 이 화면이 있어야 앱이 목표를 채운다. 이전 장소 모드는 직원이 **미리 준비된 카드만**
// 누를 수 있었고, 농인의 답은 **화면으로만** 나갔다. 실제 현장은 그렇지 않다:
//   - 의사는 카드에 없는 말을 한다 → 직원 마이크로 받아 자막 + 수어로 옮긴다
//   - 택시 기사는 운전 중 화면을 못 본다 → 농인의 답을 **소리로** 내보낸다
//   - 카드에 없는 말을 해야 할 때가 있다 → 직접 쓰면 소리로 읽어 준다
//
// 화면 문법
//   위: 아바타(수어) — 농인이 보는 쪽
//   중간: 대화 기록 — 누가 무슨 말을 했는지 시간순. 눌러 다시 보기/다시 듣기
//   아래: 두 사람의 입력 — 직원은 🎙 마이크와 질문 카드, 농인은 답 카드와 ⌨ 직접 쓰기
//
// 소리를 못 듣는 사용자에게 **소리가 나갔다는 사실**은 보이지 않는다. 그래서 말이
// 나갈 때마다 "소리로 전달했어요"를 눈으로 확인시킨다 — 이게 없으면 전달됐는지
// 알 수 없어 같은 카드를 반복해서 누르게 된다.
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { PLACES, type Place } from './places'
import { useSpeechInput } from '../hooks/useSpeechInput'
import { useSpeechOutput } from '../hooks/useSpeechOutput'
import SignStage from './SignStage'
import { useSignPlayer } from './useSignPlayer'

// 카메라 인식은 MediaPipe 번들이 무거워 열 때만 불러온다.
const SignInputPanel = lazy(() => import('./SignInputPanel'))

/** 대화 한 줄. 누가 말했나로 표현 방식이 갈린다(직원=소리로 들어옴, 농인=소리로 나감). */
interface Turn {
  who: 'staff' | 'deaf'
  text: string
  /** 상용구는 글로스가 확정돼 있다 — 다시 볼 때 번역을 건너뛴다. */
  gloss?: string[]
  time: string
}

// SOS 전체화면 문구 — 주변인이 읽는 쪽이라 한국어를 크게.
const SOS_MESSAGES = [
  '도와주세요!\n저는 청각장애인입니다',
  '119에 신고해 주세요',
  '글로 써서 보여 주세요',
  '가족에게 연락이 필요해요',
]

/** 어느 장소에서나 쓰는 답 — 장소별 카드 앞에 항상 붙인다. */
const COMMON_ANSWERS = ['네', '아니요', '잘 모르겠어요', '다시 보여 주세요', '천천히 말해 주세요', '글로 써 주세요']

const nowTime = () => new Date().toTimeString().slice(0, 5)

export default function TalkMode() {
  const [place, setPlace] = useState<Place | null>(null)
  const [turns, setTurns] = useState<Turn[]>([])
  const [sos, setSos] = useState(-1)
  // 농인이 짚은 답을 화면 가득 — 직원이 소리를 놓쳤을 때 읽는 쪽.
  const [shown, setShown] = useState<string | null>(null)
  const [writing, setWriting] = useState(false)
  const [draft, setDraft] = useState('')
  // 지금 말할 사람 — 하단 입력을 한쪽만 띄운다(폰에서 세로 여유 확보 + 차례 표시).
  const [side, setSide] = useState<'staff' | 'deaf'>('staff')
  // 수어로 답하기 — 카메라를 열어 내 수어를 읽고 소리로 내보낸다.
  const [signing, setSigning] = useState(false)
  // 자주 쓰는 문장 — 사람마다 다르다(지병·주소·복용약). 기기에 남는다.
  const [saved, setSaved] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('sb-phrases') ?? '[]') } catch { return [] }
  })
  useEffect(() => { localStorage.setItem('sb-phrases', JSON.stringify(saved)) }, [saved])

  const player = useSignPlayer()
  const tts = useSpeechOutput()
  const threadRef = useRef<HTMLDivElement>(null)

  /** 직원 말 → 대화에 쌓고 수어로 보여준다. */
  const fromStaff = useCallback((text: string, gloss?: string[]) => {
    setTurns((t) => [...t, { who: 'staff', text, gloss, time: nowTime() }])
    void player.play(text, gloss)
    // 새 말이 왔다는 신호 — 화면을 안 보고 있을 수 있다.
    navigator.vibrate?.(120)
    // 직원이 물었으면 다음은 내가 답할 차례다 — 차례를 화면이 넘겨 준다.
    setSide('deaf')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.play])

  /** 농인 말 → 대화에 쌓고 소리로 내보낸다 + 화면에도 크게(둘 다 필요하다). */
  const fromDeaf = useCallback((text: string) => {
    setTurns((t) => [...t, { who: 'deaf', text, time: nowTime() }])
    setShown(text)
    tts.speak(text)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tts.speak])

  const mic = useSpeechInput(fromStaff)

  // 대화가 길어지면 아래로 — 방금 한 말이 보여야 한다.
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns])

  // 화면을 벗어나면 마이크를 끈다 — 창구 대화가 계속 녹음되면 안 된다.
  const micStop = mic.stop
  useEffect(() => () => micStop(), [micStop])

  // 유휴 자동 초기화 — 키오스크·창구 태블릿은 **여러 사람이 돌려 쓰는 기기**다.
  // 앞사람이 "머리가 아파요"라고 답한 대화가 다음 사람 화면에 남아 있으면 안 된다.
  // 5분 손대지 않으면 대화를 지우고 장소 선택으로 돌아간다(개인 폰에서도 해롭지 않다 —
  // 대화가 없으면 아무 일도 하지 않는다).
  useEffect(() => {
    if (turns.length === 0) return
    const IDLE_MS = 5 * 60 * 1000
    let timer = window.setTimeout(() => {
      setTurns([])
      setShown(null)
      setPlace(null)
      micStop()
    }, IDLE_MS)
    const bump = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        setTurns([])
        setShown(null)
        setPlace(null)
        micStop()
      }, IDLE_MS)
    }
    const events = ['pointerdown', 'keydown'] as const
    for (const e of events) window.addEventListener(e, bump)
    return () => {
      window.clearTimeout(timer)
      for (const e of events) window.removeEventListener(e, bump)
    }
  }, [turns.length, micStop])

  // 위급 화면 — 화면 전체를 빨갛게, 문구는 방 건너에서도 읽히게.
  if (sos >= 0) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => setSos((v) => (v + 1) % SOS_MESSAGES.length)}
        onKeyDown={(e) => e.key === 'Escape' && setSos(-1)}
        className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-6 bg-red-600 p-6 text-center"
      >
        <span className="animate-pulse text-7xl">🆘</span>
        <p className="whitespace-pre-line text-4xl font-extrabold leading-snug text-white sm:text-6xl">
          {SOS_MESSAGES[sos]}
        </p>
        <p className="text-lg text-red-100">화면을 탭하면 다음 문구</p>
        <div className="mt-4 flex gap-3">
          {/* 소리까지 함께 — 주변이 화면을 못 볼 수도 있다 */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); tts.speak(SOS_MESSAGES[sos].replace('\n', ' ')) }}
            className="rounded-2xl border-2 border-white/70 px-6 py-3 text-xl font-bold text-white"
          >
            🔊 소리로
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setSos(-1) }}
            className="rounded-2xl border-2 border-white/70 px-8 py-3 text-xl font-bold text-white"
          >
            ✕ 닫기
          </button>
        </div>
      </div>
    )
  }

  if (!place) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <button
          type="button"
          onClick={() => { setSos(0); navigator.vibrate?.([400, 100, 400]) }}
          className="mb-4 w-full rounded-3xl border-2 border-red-500 bg-red-600/90 py-5 text-2xl font-extrabold text-white"
        >
          🆘 긴급 도움 요청
        </button>
        <p className="mb-3 text-center text-lg font-bold text-slate-300">어디에 계신가요?</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {PLACES.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPlace(p)}
              className="rounded-3xl border border-white/10 bg-space-800 py-8 text-center transition-colors hover:border-cyan-glow/50"
            >
              <span className="block text-5xl">{p.icon}</span>
              <span className="mt-2 block text-xl font-bold text-slate-100">{p.name}</span>
            </button>
          ))}
        </div>
        {!tts.supported && (
          <p className="mt-6 text-center text-sm text-amber-300">
            이 브라우저는 소리 내보내기를 지원하지 않아요. 답은 화면으로 보여 드릴게요.
          </p>
        )}
      </div>
    )
  }

  const answers = [...COMMON_ANSWERS, ...place.answer, ...saved]

  if (signing) {
    return (
      <Suspense fallback={<div className="grid flex-1 place-items-center text-slate-400">카메라 여는 중…</div>}>
        <SignInputPanel onSend={fromDeaf} onClose={() => setSigning(false)} />
      </Suspense>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 상단바 */}
      <div className="flex shrink-0 items-center gap-2 border-b border-white/10 px-3 py-2">
        <button
          type="button"
          onClick={() => { setPlace(null); mic.stop() }}
          className="rounded-lg border border-white/15 px-3 py-1.5 text-base text-slate-300"
        >
          ← 장소
        </button>
        <span className="text-xl font-bold text-slate-100">{place.icon} {place.name}</span>
        {turns.length > 0 && (
          <button
            type="button"
            onClick={() => { setTurns([]); setShown(null) }}
            className="ml-auto min-h-[44px] rounded-lg border border-white/15 px-3 py-2 text-sm text-slate-400"
          >
            대화 지우기
          </button>
        )}
      </div>

      {/* 넓은 화면(태블릿 가로·키오스크)에서는 위아래가 아니라 좌우로 나눈다.
          창구에 놓인 태블릿은 대개 가로다 — 세로로만 쌓으면 아바타가 작아지고
          대화 기록이 눌린다. 폭이 있으면 폭을 쓰는 편이 둘 다 살린다. */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <div className="flex min-h-0 flex-col lg:w-1/2 lg:border-r lg:border-white/10">
      {/* 아바타 — 직원 말이 수어로 오는 곳 */}
      <div className="flex min-h-[30vh] flex-col sm:min-h-[40vh] lg:min-h-0 lg:flex-1">
        <SignStage
          player={player}
          compact
          idle={
            <p className="text-lg leading-relaxed text-slate-400">
              🎙 아래 <b className="text-cyan-soft">직원이 말하기</b>를 누르고 말하면<br />
              여기에 수어로 보여 드려요
            </p>
          }
        />
      </div>

      {/* 말하는 중인 잠정 자막 — 확정 전에도 무슨 말인지 눈으로 따라갈 수 있게.
          농인 입장에서 "지금 무슨 말을 하고 있는지"를 모르는 침묵이 가장 불안하다. */}
      {mic.listening && (
        <div className="shrink-0 border-y border-cyan-glow/30 bg-cyan-glow/10 px-4 py-2 text-center">
          <p className="text-lg font-bold text-cyan-soft">
            {mic.interim || '🎙 듣고 있어요… 말씀하세요'}
          </p>
        </div>
      )}

      {/* 대화 기록 */}
      <div ref={threadRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {turns.length === 0 ? (
          <p className="py-4 text-center text-base text-slate-500">
            주고받은 말이 여기에 남아요
          </p>
        ) : (
          turns.map((t, i) => (
            <button
              key={i}
              type="button"
              onClick={() => (t.who === 'staff' ? void player.play(t.text, t.gloss) : tts.speak(t.text))}
              className={`mb-1.5 flex w-full items-start gap-2 rounded-2xl border px-3 py-2 text-left ${
                t.who === 'staff'
                  ? 'border-cyan-glow/30 bg-cyan-glow/5'
                  : 'ml-auto border-amber-400/30 bg-amber-400/5'
              }`}
            >
              <span className="shrink-0 text-xl">{t.who === 'staff' ? '👔' : '🤟'}</span>
              <span className={`flex-1 text-lg font-bold leading-snug ${
                t.who === 'staff' ? 'text-cyan-soft' : 'text-amber-200'
              }`}>
                {t.text}
              </span>
              <span className="shrink-0 text-xs text-slate-500">{t.time}</span>
              <span className="shrink-0 text-base text-slate-500">{t.who === 'staff' ? '🤟' : '🔊'}</span>
            </button>
          ))
        )}
      </div>

      {/* 농인이 짚은 답 — 화면 가득. 직원이 소리를 놓쳤을 때 읽는 쪽. */}
      {shown && (
        <button
          type="button"
          onClick={() => setShown(null)}
          className="shrink-0 border-t border-amber-400/30 bg-amber-400/10 px-4 py-4 text-center"
        >
          <span className="block text-3xl font-extrabold text-amber-200 sm:text-4xl">{shown}</span>
          {/* 소리가 나갔는지는 듣지 못하는 사용자가 확인할 수 없다 — 눈으로 알려준다.
              실패했으면 반드시 실패라고 말한다(전달된 줄 알고 기다리는 것이 더 위험하다). */}
          <span className={`mt-1 block text-sm font-bold ${
            tts.failed ? 'text-red-300' : 'text-emerald-300'
          }`}>
            {tts.failed
              ? '⚠️ 소리가 나가지 않았어요 — 이 화면을 보여 주세요'
              : tts.speaking
                ? '🔊 소리로 말하는 중…'
                : '🔊 소리로 전달했어요'}
          </span>
        </button>
      )}

      {/* 직접 쓰기 — 카드에 없는 말. 쓰면 소리로 읽어 준다. */}
      {writing && (
        <div className="shrink-0 border-t border-white/10 bg-space-900 p-3">
          <input
            type="text"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && draft.trim()) {
                fromDeaf(draft.trim())
                setDraft('')
                setWriting(false)
              }
            }}
            placeholder="하고 싶은 말을 쓰세요"
            className="w-full rounded-2xl border border-white/15 bg-space-950 px-4 py-3 text-xl text-slate-100 placeholder:text-slate-500 focus:border-amber-400/60 focus:outline-none"
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={!draft.trim()}
              onClick={() => { fromDeaf(draft.trim()); setDraft(''); setWriting(false) }}
              className="flex-1 rounded-2xl border border-amber-400/50 bg-amber-400/15 py-3 text-lg font-bold text-amber-200 disabled:opacity-40"
            >
              🔊 소리로 말하기
            </button>
            <button
              type="button"
              disabled={!draft.trim() || saved.includes(draft.trim())}
              onClick={() => setSaved((s) => [...s, draft.trim()].slice(-12))}
              className="rounded-2xl border border-white/15 px-4 py-3 text-lg font-bold text-slate-300 disabled:opacity-40"
              title="자주 쓰는 문장으로 저장"
            >
              ⭐ 저장
            </button>
            <button
              type="button"
              onClick={() => { setWriting(false); setDraft('') }}
              className="rounded-2xl border border-white/15 px-4 py-3 text-lg text-slate-300"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      </div>

      {/* 아래(넓은 화면에서는 오른쪽): 지금 말할 사람의 입력만 보여준다.
          폰 화면(390×844)에서 두 사람의 카드를 동시에 펼치면 대화 기록이 0px로 눌린다.
          한쪽만 띄우면 세로 여유가 생기고, "지금 누구 차례인가"도 화면이 알려준다. */}
      <div className="flex shrink-0 flex-col border-t border-white/10 bg-space-900/60 lg:w-1/2 lg:border-t-0">
        {/* 마이크는 차례와 무관하게 항상 보인다 — 직원이 자유롭게 말하는 것이
            이 화면의 가장 중요한 입구다. 차례에 따라 숨으면 직원이 못 찾는다. */}
        <div className="px-3 pt-3">
          <button
            type="button"
            disabled={!mic.supported}
            onClick={mic.toggle}
            className={`w-full rounded-2xl border-2 py-4 text-xl font-extrabold transition-colors disabled:opacity-40 ${
              mic.listening
                ? 'animate-pulse border-red-400 bg-red-500/20 text-red-200'
                : 'border-cyan-glow/50 bg-cyan-glow/10 text-cyan-soft'
            }`}
          >
            {mic.listening ? '⏹ 말하기 끝' : '🎙 직원이 말하면 수어로'}
          </button>
          {!mic.supported && (
            <p className="mt-1 text-center text-sm text-amber-300">
              이 브라우저는 마이크 인식을 지원하지 않아요. 아래 카드를 눌러 주세요.
            </p>
          )}
          {mic.error && <p className="mt-1 text-center text-sm text-red-300">{mic.error}</p>}
        </div>
        <div className="grid grid-cols-2 gap-1 p-2">
          {([['staff', '👔 직원 질문 카드'], ['deaf', '🤟 내 답 카드']] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setSide(id)}
              aria-pressed={side === id}
              className={`rounded-xl py-2.5 text-base font-extrabold transition-colors ${
                side === id
                  ? id === 'staff'
                    ? 'bg-cyan-glow/20 text-cyan-soft'
                    : 'bg-amber-400/20 text-amber-200'
                  : 'text-slate-500'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="max-h-[30vh] overflow-y-auto px-3 pb-3 lg:max-h-none lg:min-h-0 lg:flex-1">
          {side === 'staff' ? (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {place.ask.map((q) => (
                  <button
                    key={q.label}
                    type="button"
                    onClick={() => fromStaff(q.text, q.gloss)}
                    className="rounded-2xl border border-cyan-glow/40 bg-cyan-glow/10 px-3 py-3 text-base font-bold text-cyan-soft transition-colors hover:bg-cyan-glow/20"
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="mb-2 grid grid-cols-2 gap-2">
                {/* 수어로 답하기 — 카드도 한글도 거치지 않는 **모어로 말하는** 길이다. */}
                <button
                  type="button"
                  onClick={() => setSigning(true)}
                  className="rounded-2xl border-2 border-cyan-glow/50 bg-cyan-glow/10 py-4 text-xl font-extrabold text-cyan-soft"
                >
                  🤟 수어로 답하기
                </button>
                <button
                  type="button"
                  onClick={() => setWriting((v) => !v)}
                  className="rounded-2xl border-2 border-amber-400/50 bg-amber-400/10 py-4 text-xl font-extrabold text-amber-200"
                >
                  ⌨ 글로 쓰기
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {answers.map((a, i) => (
                  <button
                    key={`${a}-${i}`}
                    type="button"
                    onClick={() => fromDeaf(a)}
                    className="rounded-2xl border border-white/10 bg-space-800 px-4 py-3 text-lg font-bold text-slate-200 transition-colors hover:border-amber-400/50 hover:text-amber-200"
                  >
                    {a}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      </div>
    </div>
  )
}

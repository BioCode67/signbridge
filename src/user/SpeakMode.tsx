// 수어 이용자 화면의 "말하기" 모드 — 웹캠에 수어 → 인식 → 답을 수어로 돌려받는다.
//
// 소개 페이지의 인식 데모와 같은 훅(useHolistic·useRecognizer)을 쓰되, 화면 문법이
// 다르다: 설명 없이 카메라가 주인공, 인식된 단어는 크게, 버튼은 둘뿐(지우기·질문).
// MediaPipe 번들이 무거워 이 컴포넌트는 lazy로만 불러온다.
import { useCallback, useEffect, useRef, useState } from 'react'
import { glossLabel } from '../agents/glossLabel'
import { useHolistic } from '../recognition/useHolistic'
import { useRecognizer } from '../recognition/useRecognizer'
import { Orchestrator } from '../agents/orchestrator'
import type { LandmarkFrame } from '../recognition/landmarks'
import RecognizedWords from './RecognizedWords'

interface Props {
  /** 답변 문장을 받기 화면(아바타)으로 넘긴다. */
  onAnswer: (text: string) => void
}

export default function SpeakMode({ onAnswer }: Props) {
  const pushFrameRef = useRef<(f: Float32Array | null) => void>(() => {})
  const onFrame = useCallback((_f: LandmarkFrame, features: Float32Array | null) => {
    pushFrameRef.current(features)
  }, [])

  const holistic = useHolistic({ onFrame })
  const { videoRef, overlayRef, status, error, start, stop } = holistic
  const running = status === 'running'
  const rec = useRecognizer(running)
  // 렌더 중에 ref를 건드리지 않는다 — 렌더는 순수해야 하고, 리액트가 렌더를 버리거나
  // 두 번 돌릴 때 값이 어긋난다. 효과에서 최신 콜백을 꽂아 준다(SignInputPanel과 같은 방식).
  useEffect(() => { pushFrameRef.current = rec.pushFrame }, [rec.pushFrame])

  const [busy, setBusy] = useState(false)
  const orchestratorRef = useRef<Orchestrator | null>(null)

  // 화면에 들어오면 카메라를 바로 켠다 — 이 모드에 온 이유가 그것뿐이다.
  useEffect(() => {
    void start()
    return () => stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const ask = useCallback(async () => {
    if (busy || rec.transcript.length === 0) return
    setBusy(true)
    try {
      if (!orchestratorRef.current) orchestratorRef.current = new Orchestrator()
      const tokens = rec.transcript.map((t) => t.replace(/[0-9#:]+$/, ''))
      const result = await orchestratorRef.current.run({ tokens, question: tokens.join(' ') })
      onAnswer(result.qa?.answer ?? result.assessment.summary)
      rec.clearTranscript()
    } finally {
      setBusy(false)
    }
  }, [busy, rec, onAnswer])

  const confident = rec.current !== null && rec.current.confidence >= 0.5

  return (
    <div className="flex h-full flex-col">
      <div className="relative min-h-0 flex-1 overflow-hidden bg-black">
        <video
          ref={videoRef}
          playsInline
          muted
          className="absolute inset-0 h-full w-full -scale-x-100 object-cover opacity-90"
        />
        <canvas ref={overlayRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />

        {status === 'loading' && (
          <div className="absolute inset-0 grid place-items-center bg-space-950/80">
            <span className="animate-pulse text-2xl text-slate-300">카메라 준비 중…</span>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 grid place-items-center bg-space-950/90 p-6 text-center">
            <p className="text-lg text-red-300">{error}</p>
          </div>
        )}
        {rec.modelStatus === 'loading' && running && (
          <div className="absolute inset-x-0 top-4 text-center">
            <span className="rounded-full bg-space-900/90 px-4 py-2 text-base text-cyan-soft">
              인식 모델 내려받는 중{rec.loadPct != null ? ` ${rec.loadPct}%` : '…'} (최초 1회)
            </span>
          </div>
        )}

        {/* 지금 인식 중인 단어 — 크게 */}
        {running && (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-4 pb-4 pt-14 text-center">
            <p className={`text-4xl font-extrabold ${confident ? 'text-cyan-soft text-glow' : 'text-slate-500'}`}>
              {confident && rec.current ? glossLabel(rec.current.label) : '…'}
            </p>
            {/* 후보 2~3위 — AI가 무엇과 헷갈리는지 투명하게. 인식이 애매할 때
                사용자가 "아, 비슷한 동작이구나"를 바로 안다. */}
            {rec.top3.length > 1 && (
              <p className="mt-1 flex justify-center gap-2 text-sm text-slate-400">
                {rec.top3.slice(1).map((c) => (
                  <span key={c.label}>
                    {glossLabel(c.label)} {Math.round(c.confidence * 100)}%
                  </span>
                ))}
              </p>
            )}
            {/* 낱말을 누르면 후보에서 고를 수 있다 — 틀린 낱말로 질문하면 엉뚱한 답이 온다 */}
            <RecognizedWords
              words={rec.transcript}
              alts={rec.transcriptAlts}
              onReplace={rec.replaceWord}
            />
          </div>
        )}
      </div>

      <nav className="grid grid-cols-2 gap-2 border-t border-white/10 p-3">
        <button
          type="button"
          disabled={rec.transcript.length === 0}
          onClick={rec.clearTranscript}
          className="rounded-2xl border border-white/15 bg-space-800 py-4 text-xl font-bold text-slate-200 disabled:opacity-40"
        >
          🗑 지우기
        </button>
        <button
          type="button"
          disabled={busy || rec.transcript.length === 0}
          onClick={() => void ask()}
          className="rounded-2xl border border-emerald-400/50 bg-emerald-400/10 py-4 text-xl font-bold text-emerald-300 disabled:opacity-40"
        >
          {busy ? '…' : '💬 질문'}
        </button>
      </nav>
    </div>
  )
}

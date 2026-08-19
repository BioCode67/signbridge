// 수어로 답하기 — 카메라로 내 수어를 읽어 **소리로 내보낸다.**
//
// **왜 이게 마지막 조각인가.** 대화 모드에서 농인이 답하는 길은 지금까지 둘뿐이었다:
// 카드를 짚거나, 한글로 쓰거나. 둘 다 한국어를 거친다 — 수어가 모어이고 한국어가
// 제2언어인 사람에게는 그 자체가 부담이고, 카드에 없는 말은 결국 못 한다.
// 수어로 답하고 그것이 소리로 나가야 비로소 **모어로 말하는** 것이다.
//
// 지금 인식기는 낱말 단위(고립 단어)다. 그래서 이 화면도 낱말을 쌓는 방식으로 만든다 —
// "머리 · 어제 · 아프다"처럼 모아 한 번에 전한다. 문장 단위 연속 인식(CTC)이 나오면
// 이 화면은 그대로 두고 인식기만 바꿔 끼우면 된다.
//
// 카메라 영상은 **어디로도 전송되지 않는다**(브라우저 안에서 추론). 병원 창구에서
// 쓰는 물건이라 이 사실이 중요하다 — 화면에도 적어 둔다.
import { useCallback, useEffect, useRef } from 'react'
import { glossLabel } from '../agents/glossLabel'
import { useHolistic } from '../recognition/useHolistic'
import { useRecognizer } from '../recognition/useRecognizer'
import type { LandmarkFrame } from '../recognition/landmarks'
import { glossesToKorean } from '../agents/glossToKorean'
import RecognizedWords from './RecognizedWords'

interface Props {
  /** 모은 낱말을 상대에게 전한다(대화 기록 + 음성 출력). */
  onSend: (text: string) => void
  onClose: () => void
}

export default function SignInputPanel({ onSend, onClose }: Props) {
  const pushFrameRef = useRef<(f: Float32Array | null) => void>(() => {})
  const onFrame = useCallback((_f: LandmarkFrame, features: Float32Array | null) => {
    pushFrameRef.current(features)
  }, [])

  const holistic = useHolistic({ onFrame })
  const { videoRef, overlayRef, status, error, start, stop } = holistic
  const running = status === 'running'
  const rec = useRecognizer(running)
  useEffect(() => { pushFrameRef.current = rec.pushFrame }, [rec.pushFrame])

  // 이 패널에 들어온 이유가 카메라뿐이다 — 바로 켠다.
  useEffect(() => {
    void start()
    return () => stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const words = rec.transcript.map(glossLabel)
  const confident = rec.current !== null && rec.current.confidence >= 0.5

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-black">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <video
          ref={videoRef}
          playsInline
          muted
          className="absolute inset-0 h-full w-full -scale-x-100 object-cover opacity-90"
        />
        <canvas ref={overlayRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />

        {status === 'loading' && (
          <div className="absolute inset-0 grid place-items-center bg-space-950/80">
            <span className="animate-pulse text-xl text-slate-300">카메라 준비 중…</span>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 grid place-items-center bg-space-950/90 p-6 text-center">
            <p className="text-lg text-red-300">{error}</p>
          </div>
        )}
        {rec.modelStatus === 'loading' && running && (
          <div className="absolute inset-x-0 top-3 text-center">
            <span className="rounded-full bg-space-900/90 px-4 py-2 text-base text-cyan-soft">
              인식 모델 내려받는 중{rec.loadPct != null ? ` ${rec.loadPct}%` : '…'} (최초 1회)
            </span>
          </div>
        )}

        {/* 지금 읽고 있는 낱말 */}
        {running && (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-3 pb-3 pt-10 text-center">
            <p className={`text-3xl font-extrabold ${confident ? 'text-cyan-soft text-glow' : 'text-slate-500'}`}>
              {confident && rec.current ? glossLabel(rec.current.label) : '…'}
            </p>
            {/* 아직 아무것도 못 알아들었을 때 — **무엇을 하면 되는지** 보여준다.
                묻기 화면과 같은 이유다. 카메라만 켜 두면 처음 쓰는 사람은
                무엇을 해야 할지 모른 채 기다린다. 창구에서 답할 만한 것을
                예시로 둔다 — 인식 클래스에 실존하는 낱말만 적는다. */}
            {words.length === 0 && (
              <p className="mx-auto max-w-xs break-keep rounded-2xl bg-black/60 px-4 py-2.5 text-base leading-relaxed text-slate-200">
                손을 화면 가운데 두고 <b className="text-cyan-soft">한 낱말씩</b> 해 주세요
                <br />
                <span className="text-sm text-slate-400">예 · 맞다 · 아니다 · 머리 · 아프다 · 모르다</span>
              </p>
            )}

            {words.length > 0 && (
              <>
                <RecognizedWords
                  words={rec.transcript}
                  alts={rec.transcriptAlts}
                  onReplace={rec.replaceWord}
                />
                {/* 전하기를 누르면 나갈 문장 — 소리를 못 듣는 사용자가 미리 확인한다 */}
                <p className="mt-1 text-base font-bold text-amber-200">
                  🔊 “{glossesToKorean(rec.transcript)}”
                </p>
              </>
            )}
          </div>
        )}
        <p className="absolute left-3 top-3 rounded-lg bg-black/60 px-2 py-1 text-xs text-slate-300">
          🔒 영상은 이 기기 안에서만 처리돼요
        </p>
      </div>

      <div className="grid shrink-0 grid-cols-3 gap-2 border-t border-white/10 p-3">
        <button
          type="button"
          onClick={onClose}
          className="min-h-[44px] rounded-2xl border border-white/15 bg-space-800 py-3 text-lg font-bold text-slate-200"
        >
          ✕ 닫기
        </button>
        <button
          type="button"
          disabled={words.length === 0}
          onClick={rec.clearTranscript}
          className="min-h-[44px] rounded-2xl border border-white/15 bg-space-800 py-3 text-lg font-bold text-slate-200 disabled:opacity-40"
        >
          🗑 지우기
        </button>
        <button
          type="button"
          disabled={words.length === 0}
          onClick={() => {
            // 낱말 나열("머리 어제 아프다")이 아니라 말이 되는 문장으로 내보낸다 —
            // 직원이 듣는 쪽이라, 어미 하나가 되묻는 횟수를 줄인다.
            onSend(glossesToKorean(rec.transcript))
            rec.clearTranscript()
            onClose()
          }}
          className="min-h-[44px] rounded-2xl border-2 border-amber-400/60 bg-amber-400/15 py-3 text-lg font-extrabold text-amber-200 disabled:opacity-40"
        >
          🔊 전하기
        </button>
      </div>
    </div>
  )
}

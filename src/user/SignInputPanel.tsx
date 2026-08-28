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
import { useCamZoom, ZOOM_LABELS } from './camZoom'
import CamZoomButton from './CamZoomButton'

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
  // 화면 거리 조절 — **표시만** 바꾼다. 묻기 화면과 같은 값을 나눠 쓴다.
  const cam = useCamZoom()

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
      <div
        className="relative min-h-0 flex-1 overflow-hidden"
        data-sign-camfit="contain"
        data-sign-camzoom={cam.scale}
      >
        {/* 배율은 감싼 층에 건다 — video의 `-scale-x-100`과 Tailwind `scale-*`가 같은
            커스텀 속성을 써서 합성되지 않기 때문이다. 자세한 근거는 CamZoom.tsx. */}
        <div
          className="absolute inset-0"
          style={cam.scale !== 1 ? { transform: `scale(${cam.scale})`, transformOrigin: 'center' } : undefined}
        >
          {/* video와 canvas에 **같은** fit을 준다(예전에는 canvas만 fill이라 뼈대가 어긋났다). */}
          <video
            ref={videoRef}
            playsInline
            muted
            className="absolute inset-0 h-full w-full -scale-x-100 object-contain opacity-90"
          />
          <canvas ref={overlayRef} className="absolute inset-0 h-full w-full object-contain" aria-hidden="true" />
        </div>

        <CamZoomButton zoom={cam.zoom} label={cam.label} name={cam.name}
          hint={cam.hint} onNext={cam.next} big={cam.kiosk} />

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

        {/* 손이 화면에 없으면 **낱말을 내지 않는다.**
            손이 없으면 특징 벡터가 매번 같아져서 모델이 같은 낱말을 자신 있게 낸다
            (실측: 얼굴만 잡힌 판에서 무슨 동작을 하든 `지시`). 그때는 낱말 대신
            무엇을 하면 되는지 알려 주는 편이 옳다. */}
        {running && !rec.handsSeen && (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-3 pb-3 pt-10 text-center">
            <p className="text-2xl font-extrabold text-amber-300">✋ 손이 안 보여요</p>
            <p className="mx-auto mt-2 max-w-xs break-keep rounded-2xl bg-black/60 px-4 py-2.5 text-base leading-relaxed text-slate-200">
              조금 뒤로 물러나서 <b className="text-white">양손이 화면 안</b>에 들어오게 해 주세요.
              손을 가슴 높이로 들면 잘 잡혀요.
            </p>
            {/* 확대 중에는 화면 ≠ 프레임이다 — 손이 프레임 안인데 화면 밖일 수 있다. */}
            {cam.zoom > 0 && (
              <p className="mx-auto mt-2 max-w-xs break-keep rounded-2xl bg-black/60 px-4 py-2 text-base leading-relaxed text-amber-200">
                지금 화면을 크게 보고 있어요 — <b className="text-white">{ZOOM_LABELS[0]}</b>로 바꾸면
                손이 더 잘 들어와요.
              </p>
            )}
          </div>
        )}

        {/* 지금 읽고 있는 낱말 */}
        {running && rec.handsSeen && (
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

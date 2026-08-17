// 장소 모드 — 병원·주민센터·택시 창구에서 직원과 농인이 **함께 보는** 화면.
//
// 흐름: 직원이 질문 카드를 누르면 아바타가 수어로 표현하고(받기 화면 전환),
// 농인은 하단 답 카드를 손가락으로 짚어 답한다. 답 카드는 한국어를 아주 크게 —
// 직원이 읽는 쪽이기 때문이다. 앱 하나로 대화가 왕복하는 것이 목표다.
import { useState } from 'react'
import { PLACES, type Place } from './places'

interface Props {
  /** 문장을 수어로 재생한다(받기 화면에서). 글로스 직접 지정 가능. */
  onSign: (text: string, gloss?: string[]) => void
}

// SOS 전체화면 문구 — 탭할 때마다 다음 문구로. 주변인이 읽는 쪽이라 한국어를 크게.
const SOS_MESSAGES = [
  '도와주세요!\n저는 청각장애인입니다',
  '119에 신고해 주세요',
  '글로 써서 보여 주세요',
  '가족에게 연락이 필요해요',
]

export default function PlaceMode({ onSign }: Props) {
  const [place, setPlace] = useState<Place | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [sos, setSos] = useState(-1) // -1=닫힘, 0~=문구 번호

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
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setSos(-1) }}
          className="mt-4 rounded-2xl border-2 border-white/70 px-8 py-3 text-xl font-bold text-white"
        >
          ✕ 닫기
        </button>
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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
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
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2">
        <button
          type="button"
          onClick={() => { setPlace(null); setPicked(null) }}
          className="rounded-lg border border-white/15 px-3 py-1.5 text-base text-slate-300"
        >
          ← 장소
        </button>
        <span className="text-xl font-bold text-slate-100">{place.icon} {place.name}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {/* 직원용: 누르면 아바타가 수어로 */}
        <p className="mb-2 text-sm font-bold text-cyan-soft">👔 직원이 누르면 → 아바타가 수어로 전달</p>
        <div className="grid grid-cols-2 gap-2">
          {place.ask.map((q) => (
            <button
              key={q.label}
              type="button"
              onClick={() => onSign(q.text, q.gloss)}
              className="rounded-2xl border border-cyan-glow/40 bg-cyan-glow/10 px-3 py-4 text-base font-bold text-cyan-soft transition-colors hover:bg-cyan-glow/20"
            >
              {q.label}
            </button>
          ))}
        </div>

        {/* 농인용: 짚어서 보여 주는 답 — 한국어 크게(직원이 읽는다) */}
        <p className="mb-2 mt-6 text-sm font-bold text-amber-300">🤟 수어 이용자가 짚어서 답하기</p>
        <div className="flex flex-wrap gap-2">
          {place.answer.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setPicked(a)}
              className={`rounded-2xl border px-4 py-3 text-lg font-bold transition-colors ${
                picked === a
                  ? 'border-amber-400 bg-amber-400/20 text-amber-200'
                  : 'border-white/10 bg-space-800 text-slate-200 hover:border-amber-400/50'
              }`}
            >
              {a}
            </button>
          ))}
        </div>
      </div>

      {/* 짚은 답을 화면 가득 — 직원에게 보여 주는 용도 */}
      {picked && (
        <button
          type="button"
          onClick={() => setPicked(null)}
          className="border-t border-amber-400/30 bg-amber-400/10 px-4 py-6 text-center"
        >
          <span className="text-3xl font-extrabold text-amber-200">{picked}</span>
          <span className="mt-1 block text-xs text-slate-500">탭하면 닫기</span>
        </button>
      )}
    </div>
  )
}

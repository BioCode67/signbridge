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

export default function PlaceMode({ onSign }: Props) {
  const [place, setPlace] = useState<Place | null>(null)
  const [picked, setPicked] = useState<string | null>(null)

  if (!place) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
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

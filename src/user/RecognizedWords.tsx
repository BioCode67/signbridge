// 인식된 낱말 — 누르면 후보에서 고를 수 있다.
//
// **왜 고를 수 있어야 하나.** 모델은 낱말 하나를 78.2%로 맞힌다(top-5는 91.9%).
// 틀린 낱말이 소리로 나가거나 질문으로 들어가면 그 자리에서 바로 오해가 된다 —
// "머리"와 "허리"는 진료가 달라진다. 확정된 낱말을 눌러 후보에서 고르게 하면
// **손가락 한 번으로 top-1을 top-5로 바꾸는 셈**이라, 모델을 더 키우는 것보다
// 지금 확실하다.
//
// 수어 입력(대화)과 질문 탭이 같은 화면 문법을 쓰도록 한 곳에 둔다.
import { useState } from 'react'
import { glossLabel } from '../agents/glossLabel'

interface Props {
  /** 확정된 낱말(글로스 ID) */
  words: string[]
  /** 낱말별 상위 후보 — words와 같은 길이 */
  alts: string[][]
  onReplace(index: number, label: string): void
}

const bare = glossLabel

export default function RecognizedWords({ words, alts, onReplace }: Props) {
  const [fixing, setFixing] = useState<number | null>(null)
  if (words.length === 0) return null

  return (
    <>
      <p className="mt-2 flex flex-wrap justify-center gap-1.5">
        {words.map((w, i) => (
          <button
            key={`${w}-${i}`}
            type="button"
            onClick={() => setFixing((v) => (v === i ? null : i))}
            className={`min-h-[40px] rounded-lg px-2.5 py-1 text-lg font-bold ${
              fixing === i ? 'bg-amber-400/30 text-amber-200' : 'bg-cyan-glow/15 text-cyan-soft'
            }`}
          >
            {bare(w)}
          </button>
        ))}
      </p>
      {fixing !== null && (alts[fixing]?.length ?? 0) > 1 && (
        <div className="mt-1.5 rounded-2xl bg-space-900/95 p-2">
          <p className="mb-1 text-sm text-slate-400">이 낱말이 맞나요? 다른 것을 누르세요</p>
          <div className="flex flex-wrap justify-center gap-1.5">
            {alts[fixing].map((alt) => (
              <button
                key={alt}
                type="button"
                onClick={() => { onReplace(fixing, alt); setFixing(null) }}
                className="min-h-[40px] rounded-lg border border-white/15 px-3 py-1 text-lg font-bold text-slate-200"
              >
                {bare(alt)}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

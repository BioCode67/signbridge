// 지난 대화 — 병원에서 들은 말을 나중에 다시 확인한다.
//
// 창구에서 오간 말 중에는 나중에 꼭 다시 봐야 하는 것이 있다. "3일 뒤에 다시 오세요",
// "하루 세 번 식후에", "다음 진료는 화요일" — 하필 이런 것이 가장 잊기 쉽다.
// 통역사가 있었다면 메모라도 남았겠지만, 혼자 갔다면 남는 것이 없다.
//
// 문장을 누르면 **그때처럼** 다시 확인할 수 있다 — 직원 말은 수어로, 내 말은 소리로.
import type { SavedTalk } from './talkHistory'

interface Props {
  talks: SavedTalk[]
  onBack(): void
  onDelete(id: string): void
  onClearAll(): void
  /** 직원이 한 말 — 다시 수어로 본다 */
  onReplaySign(text: string): void
  /** 내가 한 말 — 다시 소리로 들려준다(상대에게) */
  onReplayVoice(text: string): void
}

export default function TalkHistoryPanel({
  talks, onBack, onDelete, onClearAll, onReplaySign, onReplayVoice,
}: Props) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-white/10 px-3 py-2">
        <button
          type="button"
          onClick={onBack}
          className="min-h-[44px] rounded-lg border border-white/15 px-3 py-2 text-base text-slate-300"
        >
          ← 뒤로
        </button>
        <span className="text-xl font-bold text-slate-100">📜 지난 대화</span>
        {talks.length > 0 && (
          <button
            type="button"
            onClick={onClearAll}
            className="ml-auto min-h-[44px] rounded-lg border border-red-400/40 px-3 py-2 text-sm font-bold text-red-300"
          >
            전체 지우기
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <p className="mb-3 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-base leading-relaxed text-emerald-200">
          🔒 이 기기에만 저장돼요. 누른 문장은 다시 볼 수 있어요.
        </p>
        {talks.map((t) => (
          <div key={t.id} className="mb-3 rounded-2xl border border-white/10 bg-space-800 p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-lg font-bold text-slate-100">{t.placeIcon} {t.place}</span>
              <span className="text-sm text-slate-500">{t.date}</span>
              <button
                type="button"
                onClick={() => onDelete(t.id)}
                className="ml-auto min-h-[40px] rounded-lg border border-white/15 px-3 py-1.5 text-sm text-slate-400"
              >
                지우기
              </button>
            </div>
            {t.turns.map((turn, i) => (
              <button
                key={i}
                type="button"
                onClick={() => (turn.who === 'staff'
                  ? onReplaySign(turn.text)
                  : onReplayVoice(turn.text))}
                className={`mb-1 flex w-full items-start gap-2 rounded-xl px-3 py-2 text-left ${
                  turn.who === 'staff' ? 'bg-cyan-glow/10' : 'bg-amber-400/10'
                }`}
              >
                <span className="shrink-0 text-lg">{turn.who === 'staff' ? '👔' : '🤟'}</span>
                <span className={`flex-1 text-base font-bold leading-snug ${
                  turn.who === 'staff' ? 'text-cyan-soft' : 'text-amber-200'
                }`}>
                  {turn.text}
                </span>
                <span className="shrink-0 text-sm text-slate-500">{turn.time}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

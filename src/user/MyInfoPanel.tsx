// 내 정보 편집 — 응급실·창구에서 보여줄 나에 대한 사실을 적어 둔다.
//
// 화면 문법: 한 항목씩 큰 글씨, 빈칸은 힌트로 무엇을 적는지 알려 준다. 저장은 자동이다
// (저장 버튼을 누르지 않아 날아가는 일이 없게 — 응급 정보는 그런 식으로 잃으면 안 된다).
import { useEffect, useState } from 'react'
import { MY_INFO_FIELDS, loadMyInfo, saveMyInfo, type MyInfo } from './myInfo'

interface Props {
  onClose: () => void
}

export default function MyInfoPanel({ onClose }: Props) {
  const [info, setInfo] = useState<MyInfo>(() => loadMyInfo())
  // 입력이 멈추면 저장한다 — 매 글자마다 쓰면 느리고, 버튼을 두면 안 누르고 나간다.
  useEffect(() => {
    const t = window.setTimeout(() => saveMyInfo(info), 400)
    return () => window.clearTimeout(t)
  }, [info])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-white/10 px-3 py-2">
        <button
          type="button"
          onClick={onClose}
          className="min-h-[44px] rounded-lg border border-white/15 px-3 py-2 text-base text-slate-300"
        >
          ← 뒤로
        </button>
        <span className="text-xl font-bold text-slate-100">🆔 내 정보</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <p className="mb-4 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-base leading-relaxed text-emerald-200">
          응급실이나 창구에서 <b>말 대신 보여주는</b> 정보예요.<br />
          🔒 이 기기에만 저장되고 <b>어디로도 보내지 않아요.</b>
        </p>
        {MY_INFO_FIELDS.map((f) => (
          <label key={f.key} className="mb-3 block">
            <span className="mb-1 block text-base font-bold text-slate-300">
              {f.label}
              {f.urgent && <span className="ml-2 rounded bg-red-500/20 px-1.5 py-0.5 text-xs text-red-300">응급 표시</span>}
            </span>
            <input
              type="text"
              value={info[f.key] ?? ''}
              onChange={(e) => setInfo((prev) => ({ ...prev, [f.key]: e.target.value }))}
              placeholder={f.hint}
              className="w-full rounded-2xl border border-white/15 bg-space-900 px-4 py-3 text-xl text-slate-100 placeholder:text-slate-600 focus:border-cyan-glow/60 focus:outline-none"
            />
          </label>
        ))}
        <p className="mt-2 text-center text-sm text-slate-500">적는 즉시 저장돼요</p>
      </div>
    </div>
  )
}

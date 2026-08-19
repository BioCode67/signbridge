// 긴급 화면 — **주변 사람에게 보여주는** 화면이다.
//
// 위급할 때 농인이 겪는 어려움은 "도와달라고 말할 수 없다"가 아니라 "무엇을 도와야
// 하는지 상대가 모른다"에 가깝다. 그래서 이 화면은 세 가지를 한 번에 보여준다:
//   1) 나는 소리를 듣지 못한다는 사실 (방 건너에서도 읽히는 크기로)
//   2) 응급 정보 — 혈액형·지병·먹는 약·알레르기·보호자 연락처
//      의식이 흐리거나 손을 다쳐 수어를 못 할 때, 이 카드가 떠 있기만 해도 조치가 된다
//   3) 지금 위치 좌표 — 주변 사람이 소리 내어 119에 읽어 준다
//
// 배경을 빨갛게 채우는 이유는 눈에 띄기 위해서만이 아니다. 화면을 들이밀었을 때
// **무슨 상황인지 0.5초 안에 전해지는 것**이 목적이다.
import { useState } from 'react'
import { MY_INFO_FIELDS, hasMyInfo, type MyInfo } from './myInfo'

/** 탭할 때마다 넘어가는 문구 — 주변인이 읽는 쪽이라 한국어를 크게.
 *  문구와 그 순서는 이 화면만의 일이라 밖으로 내보내지 않는다. */
const SOS_MESSAGES = [
  '도와주세요!\n저는 청각장애인입니다',
  '119에 신고해 주세요',
  '글로 써서 보여 주세요',
  '가족에게 연락이 필요해요',
]

interface Props {
  myInfo: MyInfo
  coords: { lat: number; lon: number; acc: number } | null
  locating: boolean
  locError: string
  onLocate(): void
  onSpeak(text: string): void
  onClose(): void
}

export default function SosScreen({
  myInfo, coords, locating, locError, onLocate, onSpeak, onClose,
}: Props) {
  const [index, setIndex] = useState(0)
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => setIndex((v) => (v + 1) % SOS_MESSAGES.length)}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-6 bg-red-600 p-6 text-center"
    >
      <span className="animate-pulse text-7xl">🆘</span>
      <p className="whitespace-pre-line text-4xl font-extrabold leading-snug text-white sm:text-6xl">
        {SOS_MESSAGES[index]}
      </p>
      <p className="text-lg text-red-100">화면을 탭하면 다음 문구</p>

      {hasMyInfo(myInfo) && (
        <div className="w-full max-w-xl rounded-2xl bg-white/95 p-4 text-left">
          {MY_INFO_FIELDS.filter((f) => f.urgent && (myInfo[f.key] ?? '').trim()).map((f) => (
            <p key={f.key} className="mb-1 flex gap-2 text-lg leading-snug">
              <span className="w-28 shrink-0 font-bold text-red-700">{f.label}</span>
              <span className="font-extrabold text-slate-900">{myInfo[f.key]}</span>
            </p>
          ))}
        </div>
      )}

      {coords && (
        <div className="w-full max-w-xl rounded-2xl bg-white/95 p-3 text-center">
          <p className="text-base font-bold text-red-700">📍 내 위치 (119에 알려 주세요)</p>
          <p className="text-2xl font-extrabold tracking-wider text-slate-900">
            {coords.lat.toFixed(5)}, {coords.lon.toFixed(5)}
          </p>
          <p className="text-sm text-slate-600">오차 약 {Math.round(coords.acc)}m</p>
        </div>
      )}
      {locError && <p className="text-base text-red-100">{locError}</p>}

      <div className="mt-2 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onLocate() }}
          className="rounded-2xl border-2 border-white/70 px-6 py-3 text-xl font-bold text-white"
        >
          {locating ? '📍 찾는 중…' : '📍 내 위치'}
        </button>
        {/* 소리까지 함께 — 주변이 화면을 못 볼 수도 있다 */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onSpeak(SOS_MESSAGES[index].replace('\n', ' ')) }}
          className="rounded-2xl border-2 border-white/70 px-6 py-3 text-xl font-bold text-white"
        >
          🔊 소리로
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onClose() }}
          className="rounded-2xl border-2 border-white/70 px-8 py-3 text-xl font-bold text-white"
        >
          ✕ 닫기
        </button>
      </div>
    </div>
  )
}

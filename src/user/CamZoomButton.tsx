// 카메라 거리 조절 버튼 + 바꾼 직후 안내. 상태와 근거는 camZoom.ts에 있다.
import type { CamZoom } from './camZoom'

interface ButtonProps {
  zoom: CamZoom
  label: string
  name: string
  hint: boolean
  onNext: () => void
  /** 키오스크 — 서서 보는 거리라 크게. */
  big?: boolean
}

/** 배율 버튼 + 바꾼 직후 안내. 카메라 상자 안에 절대배치로 얹는다. */
export default function CamZoomButton({ zoom, label, name, hint, onNext, big }: ButtonProps) {
  return (
    <>
      <button
        type="button"
        onClick={onNext}
        title="화면 크기"
        aria-label={`화면 크기 · 지금 ${name}. 눌러서 바꾸기`}
        className={`absolute right-3 top-3 z-20 rounded-2xl bg-space-950/70 font-bold text-slate-200 active:scale-95 ${
          big ? 'min-h-[60px] px-5 py-3 text-xl' : 'min-h-[44px] px-4 py-2 text-base'
        }`}
      >
        {label}
      </button>
      {/* **버튼 바로 아래에, 다른 안내보다 위로(z-30).** 이 자리는 묻기 화면의 예시
          카드(z-10)와 겹치므로 층위를 명시해야 한다 — 가려지는 경고는 없는 것과 같고,
          그러면 확대가 인식을 돕는다고 오해한 채로 남는다.
          겹침은 눈이 아니라 `elementFromPoint`로 재야 한다. 3초짜리 알약이라
          느린 기기에서는 스크린샷을 찍기 전에 사라진다 — 실제로 그 때문에 "가려졌다"고
          잘못 읽었다. scripts/check_camera.py가 클릭과 판정을 한 번에 한다. */}
      {hint && (
        <p className="pointer-events-none absolute right-3 top-20 z-30 max-w-[75%] text-right">
          {/* **확대가 인식을 돕는다고 오해하지 않게.** 안 적으면 잘 안 될 때 더 확대한다. */}
          <span className="inline-block rounded-2xl bg-space-900/95 px-4 py-2 text-base leading-snug text-cyan-soft">
            {zoom === 0 ? '🔍 전체가 보여요' : '🔍 화면만 커져요 — 인식 범위는 그대로예요'}
          </span>
        </p>
      )}
    </>
  )
}

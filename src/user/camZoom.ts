// 카메라 화면 거리 조절 — **보이는 크기만** 바꾼다. 인식은 건드리지 않는다.
//
// 신고(2026-08-28): "웹캠 화면이 너무 가깝게 잡힌다. 거리를 조절하고 싶다."
//
// **원인은 카메라가 아니라 화면이었다.** 촬영은 앱 전체에서 640×480(4:3) 한 군데인데
// (useHolistic.ts) 폰의 카메라 칸은 세로로 길다(390×759). 거기에 `object-cover`로
// 넣고 있었다 — 상자를 채우려고 **좌우 61.5%를 잘라낸다.** 사람에게는 가로의 38.5%만
// 보이는데 모델은 640×480 전체를 본다. 그래서 화면에 적힌 "양손이 화면 안에 들어오게
// 해 주세요"는 **따를 수 없는 지시**였다 — 화면 안 ≠ 프레임 안이고, 사용자는 프레임
// 가장자리를 볼 방법이 없었다. 손을 프레임 안에 두고도 화면 밖으로 보여 뒤로 물러난다.
//
// 그래서 기본값을 `object-contain`(전체)으로 바꾼다. 그러면 화면 = 프레임이 되고,
// 확대는 거기서 **위로만** 올라간다. 1.0× 아래는 두지 않는다 — 전체보다 넓은 그림은 없다.
//
// **왜 표시만 바꾸는가.** MediaPipe에는 <video> 요소를 그대로 넘기고, MediaPipe는 그
// 요소의 내재 프레임버퍼(videoWidth×videoHeight)를 읽는다. CSS의 object-fit도
// transform도 거기 닿지 않는다. 이 파일이 155차원 특징에서 바꾸는 차원은 **0개**다.
// (증거: video에 CSS 거울 `-scale-x-100`이 걸려 있는데도 랜드마크는 반전되지 않은 채
//  돌아와 drawOverlay.ts가 `(1 - p.x)`로 한 번 더 뒤집는다. CSS가 detect에 보였다면
//  이 줄은 이중 반전이라 화면이 진작 틀어졌을 것이다.)
//
// **반대로 촬영 쪽은 절대 건드리지 않는다.** "너무 가깝다"에 가장 자연스럽게 떠오르는
// 해법인 화면비 넓히기(4:3 → 16:9)가 정확히 최악이다 — 코드를 한 줄도 안 고치고 모든
// y 특징을 1.333배 밀어 버리는데, `ml.tools.feature_parity`는 그때도 "오차 0"을 찍는다.
// 근거와 수치는 DECISIONS.md에 남겼다.
import { useCallback, useEffect, useState } from 'react'

/** 표시 배율. 0단은 object-contain 그대로(= 프레임 전체). */
export const ZOOM_STEPS = [1, 1.3, 1.6] as const
/** 버튼에 그대로 뜨는 라벨 — 이 문자열이 곧 현재 값이다(재생 속도 1×/🐢/⚡와 같은 관례). */
export const ZOOM_LABELS = ['🔍 전체', '🔍 크게', '🔍 더 크게'] as const
/** 읽어 주는 이름(이모지 없이). */
const ZOOM_NAMES = ['전체', '크게', '더 크게'] as const

export type CamZoom = 0 | 1 | 2

/** 키오스크는 저장값을 쓰지 않는다. 규칙 원본은 UserApp.tsx의 KIOSK — 여기 한 줄만 복제한다
 *  (상수를 빼내면 글씨 크기·시작 탭·닫기 숨김 3곳이 함께 움직여 회귀 위험이 커진다). */
const KIOSK = typeof window !== 'undefined' && /[?&]kiosk=1/.test(window.location.hash)

/** 카메라 화면 배율 — 두 화면(묻기 · 수어로 답하기)이 같은 값을 나눠 쓴다. */
export function useCamZoom() {
  const [zoom, setZoom] = useState<CamZoom>(() => {
    // 공용 기기에 앞사람 흔적을 남기지 않는다(talkHistory.ts와 같은 원칙).
    // 앞사람이 1.6×로 두고 가면 다음 사람은 "조금 크다"로만 느껴 아무도 신고하지 않는다.
    if (KIOSK) return 0
    const saved = Number(localStorage.getItem('sb-cam') ?? 0)
    return (saved === 1 || saved === 2 ? saved : 0) as CamZoom
  })
  // 바꾼 직후에만 잠깐 뜨는 안내.
  const [hint, setHint] = useState(false)

  useEffect(() => { if (!KIOSK) localStorage.setItem('sb-cam', String(zoom)) }, [zoom])
  useEffect(() => {
    if (!hint) return
    const t = setTimeout(() => setHint(false), 3000)
    return () => clearTimeout(t)
  }, [hint, zoom])

  const next = useCallback(() => {
    setZoom((v) => ((v + 1) % 3) as CamZoom)
    setHint(true)
  }, [])

  return { zoom, scale: ZOOM_STEPS[zoom], label: ZOOM_LABELS[zoom], name: ZOOM_NAMES[zoom], hint, next, kiosk: KIOSK }
}

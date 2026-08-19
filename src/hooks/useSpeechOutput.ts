/**
 * 텍스트 → 음성 (Web Speech Synthesis, 한국어).
 *
 * **왜 필요한가.** 지금까지 농인이 답 카드를 짚으면 화면에 큰 글씨로 떴다. 창구에서는
 * 통하지만 **택시에서는 통하지 않는다** — 기사는 운전 중 화면을 볼 수 없다. 병원에서도
 * 직원이 등을 돌리고 차트를 보는 동안에는 마찬가지다. 농인의 말이 **소리로** 나가야
 * 비로소 대화가 왕복한다. 그래서 방향은 두 갈래다:
 *
 *   직원 말(소리) → 음성인식 → 수어 아바타      (useSpeechInput)
 *   농인 답(화면) → **음성 합성** → 직원 귀      (이 파일)          ← 빠져 있던 절반
 *
 * 알아둘 것
 *  - 브라우저 내장 합성이라 **서버·요금·네트워크가 필요 없다.** 대부분의 OS에 한국어
 *    음성이 기본 내장돼 오프라인에서도 소리가 난다(재난 때 회선이 먼저 끊긴다).
 *  - 안드로이드 크롬은 `getVoices()`가 **처음에 빈 배열**을 주고 조금 뒤 `voiceschanged`로
 *    채운다. 한 번만 읽고 판단하면 "한국어 음성 없음"으로 오판한다.
 *  - iOS 사파리는 **사용자 제스처 안에서 첫 speak()** 를 해야 이후로 소리가 난다.
 *    버튼 탭에서 호출하는 구조라 문제없지만, 자동 재생으로 옮기면 조용히 막힌다.
 *  - 말하는 중 다시 speak()하면 큐에 쌓인다. 창구 대화에서는 마지막 말만 중요하므로
 *    기본을 `cancel()` 후 말하기로 잡았다.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export interface SpeechOutput {
  /** 이 브라우저·기기가 음성 합성을 지원하는가 */
  supported: boolean
  /** 한국어 음성이 실제로 설치돼 있는가 — 없으면 기본 음성으로 읽어 발음이 어색하다 */
  koreanVoice: boolean
  speaking: boolean
  /** 지금 읽고 있는(또는 마지막으로 읽은) 문장 */
  spoken: string
  /** 마지막 speak()가 실제로 소리를 내지 못했는가.
   *
   *  **왜 따로 두나.** 소리를 못 듣는 사용자는 소리가 나갔는지 **확인할 수단이 없다.**
   *  합성이 조용히 실패했는데 화면에 "소리로 전달했어요"가 떠 있으면, 사용자는 전달됐다고
   *  믿고 기다리고 직원은 아무것도 듣지 못한다. 실측에서 실제로 났던 실패다 —
   *  음성 목록이 바뀐 뒤 남아 있던 voice 객체를 대입하다 예외가 터져 speak 전체가
   *  무너졌다. 실패는 반드시 눈에 보여야 한다. */
  failed: boolean
  speak(text: string): void
  stop(): void
}

/** 한국어 음성을 고른다. 없으면 null — 기본 음성으로 읽는다(발음은 어색해도 들린다). */
function pickKorean(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const ko = voices.filter((v) => v.lang?.toLowerCase().startsWith('ko'))
  if (ko.length === 0) return null
  // 기기 내장(localService) 음성을 앞세운다 — 네트워크 음성은 오프라인에서 침묵한다.
  return ko.find((v) => v.localService) ?? ko[0]
}

export function useSpeechOutput(): SpeechOutput {
  const [supported] = useState(
    () => typeof window !== 'undefined' && 'speechSynthesis' in window,
  )
  const [koreanVoice, setKoreanVoice] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [spoken, setSpoken] = useState('')
  const [failed, setFailed] = useState(false)
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null)

  // 음성 목록은 비동기로 채워진다 — voiceschanged를 기다려야 한국어를 찾는다.
  useEffect(() => {
    if (!supported) return
    const load = () => {
      const v = pickKorean(window.speechSynthesis.getVoices())
      voiceRef.current = v
      setKoreanVoice(v !== null)
    }
    load()
    window.speechSynthesis.addEventListener('voiceschanged', load)
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load)
  }, [supported])

  // 화면을 벗어날 때 말하던 것을 끊는다 — 탭을 옮겼는데 소리가 남으면 혼란스럽다.
  useEffect(() => {
    if (!supported) return
    return () => window.speechSynthesis.cancel()
  }, [supported])

  const speak = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      setSpoken(trimmed)
      if (!supported) { setFailed(true); return }
      try {
        // 앞말을 끊는다 — 창구에서는 지금 짚은 카드가 유일하게 중요한 말이다.
        window.speechSynthesis.cancel()
        const u = new SpeechSynthesisUtterance(trimmed)
        u.lang = 'ko-KR'
        // 목소리 지정은 실패해도 말은 나가야 한다 — 발음이 어색한 편이 침묵보다 낫다.
        try {
          if (voiceRef.current) u.voice = voiceRef.current
        } catch {
          voiceRef.current = null
          setKoreanVoice(false)
        }
        // 창구는 시끄럽다 — 조금 크고 조금 느리게. 또박또박 한 번에 알아듣게.
        u.rate = 0.95
        u.pitch = 1
        u.volume = 1
        u.onstart = () => { setSpeaking(true); setFailed(false) }
        u.onend = () => setSpeaking(false)
        u.onerror = () => { setSpeaking(false); setFailed(true) }
        window.speechSynthesis.speak(u)
        setFailed(false)
      } catch {
        // 합성이 아예 막힌 경우(권한·기기·구현 차이). 조용히 넘기면 안 된다.
        setSpeaking(false)
        setFailed(true)
      }
    },
    [supported],
  )

  const stop = useCallback(() => {
    if (!supported) return
    window.speechSynthesis.cancel()
    setSpeaking(false)
  }, [supported])

  return { supported, koreanVoice, speaking, spoken, failed, speak, stop }
}

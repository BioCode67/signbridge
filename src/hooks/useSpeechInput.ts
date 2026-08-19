/**
 * 음성 → 텍스트 (Web Speech API, 한국어).
 *
 * 재난 상황에서 관제 요원이 마이크로 말하면 그대로 수어 번역으로 넘어가는 입구다.
 * 브라우저 내장 인식을 쓰므로 서버가 필요 없고 지연도 거의 없다.
 *
 * 알아둘 것
 *  - **Chrome/Edge 계열 전용**이다. Firefox·일부 브라우저에는 API 자체가 없어
 *    `supported === false`로 내려가고, 호출부는 텍스트 입력으로 계속 쓸 수 있어야 한다.
 *  - **HTTPS(또는 localhost)에서만** 동작한다. GitHub Pages는 HTTPS라 문제없다.
 *  - `interimResults`로 말하는 중간 결과를 계속 받아 화면에 흘려 준다. 확정된 문장만
 *    `onFinal`로 넘긴다 — 중간 결과로 번역을 돌리면 같은 문장을 여러 번 합성하게 된다.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

// 표준화 전 API라 타입 정의가 lib.dom에 없다. 쓰는 부분만 최소로 선언한다.
interface SpeechRecognitionAlternativeLike {
  transcript: string
}
interface SpeechRecognitionResultLike {
  isFinal: boolean
  0: SpeechRecognitionAlternativeLike
}
interface SpeechRecognitionEventLike {
  resultIndex: number
  results: {
    length: number
    [index: number]: SpeechRecognitionResultLike
  }
}
interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike

function getCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export interface SpeechInput {
  /** 이 브라우저가 음성 인식을 지원하는가 */
  supported: boolean
  listening: boolean
  /** 말하는 중인 잠정 텍스트(확정 전) */
  interim: string
  /** 마지막 오류 안내 문구 */
  error: string
  start(): void
  stop(): void
  toggle(): void
}

export function useSpeechInput(onFinal: (text: string) => void): SpeechInput {
  const [supported] = useState(() => getCtor() !== null)
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState('')

  const recRef = useRef<SpeechRecognitionLike | null>(null)
  // 콜백을 ref로 들고 있어야 인식기를 매번 새로 만들지 않는다(인식 도중 재생성 = 끊김).
  const onFinalRef = useRef(onFinal)
  useEffect(() => { onFinalRef.current = onFinal }, [onFinal])
  // 사용자가 멈춘 것인지 브라우저가 알아서 끊은 것인지 구분한다.
  const wantRef = useRef(false)

  useEffect(() => {
    const Ctor = getCtor()
    if (!Ctor) return

    const rec = new Ctor()
    rec.lang = 'ko-KR'
    rec.continuous = true
    rec.interimResults = true
    rec.maxAlternatives = 1

    rec.onresult = (event) => {
      let live = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const text = result[0].transcript
        if (result.isFinal) {
          const trimmed = text.trim()
          if (trimmed) onFinalRef.current(trimmed)
        } else {
          live += text
        }
      }
      setInterim(live)
    }

    rec.onerror = (event) => {
      // no-speech는 잠깐 조용했을 뿐이라 오류로 보여줄 일이 아니다.
      if (event.error === 'no-speech' || event.error === 'aborted') return
      // 오류 문구는 **다음에 무엇을 하면 되는지**까지 말해야 한다. 창구에서 "network"
      // 같은 말을 보면 사람은 멈춰 선다. 특히 음성 인식은 브라우저가 구글 서버로
      // 보내 처리하므로 **오프라인에서는 원리상 동작하지 않는다** — 재난 때 흔한 상황이라
      // 그때 무엇으로 대신할지(질문 카드·직접 쓰기)를 함께 알려 준다.
      setError(
        event.error === 'not-allowed'
          ? '마이크 권한이 거부되었습니다. 주소창의 자물쇠 표시에서 허용해 주세요.'
          : event.error === 'network'
            ? '인터넷이 없어 음성 인식을 할 수 없어요. 아래 질문 카드나 직접 쓰기를 써 주세요.'
            : event.error === 'audio-capture'
              ? '마이크를 찾지 못했어요. 마이크를 연결하거나 질문 카드를 눌러 주세요.'
              : `음성 인식이 멈췄어요 (${event.error}). 질문 카드를 눌러 주세요.`,
      )
      wantRef.current = false
      setListening(false)
    }

    rec.onend = () => {
      // continuous여도 브라우저가 무음이 길면 스스로 끊는다. 사용자가 멈춘 게
      // 아니라면 다시 켜서 "계속 듣는" 상태를 유지한다.
      if (wantRef.current) {
        try {
          rec.start()
          return
        } catch {
          /* 이미 시작된 상태면 무시 */
        }
      }
      setListening(false)
      setInterim('')
    }

    recRef.current = rec
    return () => {
      wantRef.current = false
      rec.onresult = null
      rec.onerror = null
      rec.onend = null
      try { rec.abort() } catch { /* 이미 정지 */ }
      recRef.current = null
    }
  }, [])

  const start = useCallback(() => {
    const rec = recRef.current
    if (!rec || wantRef.current) return
    setError('')
    wantRef.current = true
    try {
      rec.start()
      setListening(true)
    } catch {
      // 연타로 이미 시작된 경우 — 상태만 맞춰 준다.
      setListening(true)
    }
  }, [])

  const stop = useCallback(() => {
    wantRef.current = false
    setListening(false)
    setInterim('')
    try { recRef.current?.stop() } catch { /* 이미 정지 */ }
  }, [])

  const toggle = useCallback(() => {
    if (wantRef.current) stop()
    else start()
  }, [start, stop])

  return { supported, listening, interim, error, start, stop, toggle }
}

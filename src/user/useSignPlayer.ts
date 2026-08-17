/**
 * 수어 재생기 — 문장을 받아 글로스로 바꾸고, 동작 사전 조각을 이어 붙여 재생한다.
 *
 * **왜 훅으로 뽑았나.** 원래 이 로직은 UserApp 안에 있었고, 아바타는 "받기" 탭에만
 * 있었다. 그래서 장소 모드에서 직원이 질문 카드를 누르면 **화면이 받기 탭으로 튕겼다.**
 * 창구에서 마주 앉아 주고받는 대화에서 화면이 바뀌는 것은 대화가 끊기는 것과 같다.
 * 재생기를 훅으로 만들면 대화 모드가 자기 화면 안에 아바타를 놓고, 탭 이동 없이
 * 그 자리에서 수어를 보여줄 수 있다.
 *
 * 담는 것: 사전·뱅크 적재(한 번만) · 번역 · 조각 캐시 · 프레임 루프 · 지금 단어(자막).
 * 담지 않는 것: 재난문자 피드·수신 이력·요약 배지 — 그건 받기 화면의 관심사다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SignData } from '../sections/sign/signTypes'
import { composeGlosses, type BankIndex, type BankEntry } from '../sections/sign/composeLocal'
import { DictSignAgent } from '../agents/dictSignAgent'

/** 메모리에 들고 있을 동작 조각 수 — 문장 하나가 보통 10~20조각이라 넉넉하다. */
const GLOSS_CACHE_MAX = 400

/** 재생 가능한 수어 데이터 + 동작으로 표현하지 못한 낱말(낱말 카드로 띄운다). */
export type Playable = SignData & { gloss_missing?: string[] }

export interface SignPlayer {
  data: Playable | null
  frame: number
  playing: boolean
  /** 번역·조각 내려받기 중 */
  busy: boolean
  /** 지금 표현 중인 단어(자막) */
  nowGloss: string
  /** 재생 위치(초) — 문장 진행 표시에 쓴다 */
  time: number
  speed: number
  setSpeed(v: number): void
  setPlaying(v: boolean | ((p: boolean) => boolean)): void
  /** 문장을 수어로 재생한다. gloss를 주면 번역을 건너뛰고 그대로 합성한다. */
  play(text: string, gloss?: string[]): Promise<Playable | null>
  /** 이미 만들어 둔 데이터를 재생한다(캐시된 문장 되풀기). */
  playData(d: Playable): void
  /** 처음부터 다시 */
  restart(): void
  /** 동작 사전 색인 — 단어 검색 화면이 쓴다. */
  bank(): Promise<BankIndex | null>
  /** 문장을 만들되 재생하지는 않는다(미리 만들어 두기). */
  compose(text: string, gloss?: string[]): Promise<Playable | null>
}

export function useSignPlayer(): SignPlayer {
  const [data, setData] = useState<Playable | null>(null)
  const [frame, setFrame] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [busy, setBusy] = useState(false)
  const [speed, setSpeed] = useState(1)

  const frameRef = useRef(0)
  const playingRef = useRef(false)
  const speedRef = useRef(1)
  const rafRef = useRef(0)
  const lastRef = useRef(0)
  useEffect(() => { playingRef.current = playing }, [playing])
  useEffect(() => { speedRef.current = speed }, [speed])

  const dictRef = useRef<DictSignAgent | null>(null)
  const bankRef = useRef<BankIndex | null>(null)
  const cacheRef = useRef(new Map<string, SignData>())

  /** 동작 사전 색인 — 한 번만 받아 둔다(9,500종 색인, 수백 KB). */
  const bank = useCallback(async (): Promise<BankIndex | null> => {
    if (bankRef.current) return bankRef.current
    const res = await fetch(`${import.meta.env.BASE_URL}data/bank.json`)
    if (!res.ok) return null
    bankRef.current = (await res.json()) as BankIndex
    return bankRef.current
  }, [])

  /** 글로스 조각 하나 — 같은 단어를 두 번 받지 않는다(캐시).
   *
   *  캐시에 **상한을 둔다.** 창구·키오스크는 하루 종일 켜 둔 채 수백 문장을 처리하는데,
   *  조각 하나가 파싱된 상태로 수십 KB라 무제한으로 쌓으면 기기가 느려진다.
   *  넘치면 가장 오래 전에 넣은 것부터 버린다(Map은 넣은 순서를 지킨다).
   *  버려도 브라우저·서비스워커 캐시에 남아 있어 다시 받는 비용은 거의 없다. */
  const loadGloss = useCallback(async (name: string, entry: BankEntry): Promise<SignData> => {
    const cache = cacheRef.current
    const hit = cache.get(name)
    if (hit) return hit
    const res = await fetch(`${import.meta.env.BASE_URL}data/glosses/${entry.file}`)
    if (!res.ok) throw new Error(name)
    const json = (await res.json()) as SignData
    cache.set(name, json)
    while (cache.size > GLOSS_CACHE_MAX) {
      const oldest = cache.keys().next().value
      if (oldest === undefined) break
      cache.delete(oldest)
    }
    return json
  }, [])

  const compose = useCallback(
    async (text: string, gloss?: string[]): Promise<Playable | null> => {
      const index = await bank()
      if (!index) return null
      // 글로스를 직접 준 문구(장소 상용구)는 번역을 거치지 않는다 — 사람이 확정한 매핑이다.
      if (gloss?.length) return composeGlosses(text, gloss, index, loadGloss)
      if (!dictRef.current) dictRef.current = new DictSignAgent()
      const { gloss: translated, unmatched } = await dictRef.current.convert(text)
      const composed = translated.length
        ? await composeGlosses(text, translated, index, loadGloss)
        : null
      // 번역에서 빠진 낱말(지명 등)도 낱말 카드로 — 정보가 조용히 사라지면 안 된다.
      if (composed && unmatched?.length) {
        composed.gloss_missing = [...new Set([...(composed.gloss_missing ?? []), ...unmatched])]
      }
      // 한 낱말도 표현 못 하는 문장 — 동작은 없지만 **낱말은 남긴다.** 빈 화면보다
      // "이 말들은 수어로 못 보여드려요"가 정확하고, 상대에게 보여줄 것도 남는다.
      if (!composed && unmatched?.length) {
        return {
          korean_text: text, fps: 30, num_frames: 1, gloss_sequence: [],
          keypoints: { pose: [[]], hand_left: [[]], hand_right: [[]] },
          gloss_missing: [...new Set(unmatched)],
        }
      }
      return composed
    },
    [bank, loadGloss],
  )

  const playData = useCallback((d: Playable) => {
    setData(d)
    frameRef.current = 0
    setFrame(0)
    setPlaying(true)
  }, [])

  const play = useCallback(
    async (text: string, gloss?: string[]): Promise<Playable | null> => {
      setBusy(true)
      try {
        const composed = await compose(text, gloss)
        if (composed) {
          playData(composed)
          return composed
        }
        // 조용히 실패하면 사용자는 고장으로 느낀다 — 문장이라도 크게 띄운다.
        const empty: Playable = {
          korean_text: text, fps: 30, num_frames: 1, gloss_sequence: [],
          keypoints: { pose: [[]], hand_left: [[]], hand_right: [[]] },
        }
        setData(empty)
        frameRef.current = 0
        setFrame(0)
        setPlaying(false)
        return null
      } finally {
        setBusy(false)
      }
    },
    [compose, playData],
  )

  const restart = useCallback(() => {
    frameRef.current = 0
    setFrame(0)
    setPlaying(true)
  }, [])

  // 재생 루프 — fps와 속도 배율에 맞춰 프레임을 넘긴다.
  useEffect(() => {
    if (!playing || !data) return
    lastRef.current = 0
    const step = (ts: number) => {
      if (!playingRef.current) return
      if (ts - lastRef.current >= 1000 / data.fps / speedRef.current) {
        lastRef.current = ts
        const next = frameRef.current + 1
        if (next >= data.num_frames) {
          frameRef.current = 0
          setFrame(0)
          setPlaying(false)
          return
        }
        frameRef.current = next
        setFrame(next)
      }
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(rafRef.current)
  }, [playing, data])

  const time = data ? frame / data.fps : 0
  const nowGloss = useMemo(() => {
    if (!data) return ''
    return data.gloss_sequence
      .filter((g) => time >= g.start && time <= g.end)
      .map((g) => g.gloss.replace(/[0-9#:]+$/, ''))
      .join(' ')
  }, [data, time])

  return {
    data, frame, playing, busy, nowGloss, time, speed,
    setSpeed, setPlaying, play, playData, restart, bank, compose,
  }
}

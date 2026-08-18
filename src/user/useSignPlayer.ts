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
import { glossLabel } from '../agents/glossLabel'
import type { SignData } from '../sections/sign/signTypes'
import { composeGlosses, type BankIndex, type BankEntry } from '../sections/sign/composeLocal'
import { NnSignAgent } from '../agents/nnSignAgent'
import { DictSignAgent } from '../agents/dictSignAgent'

/** 메모리에 들고 있을 동작 조각 수 — 문장 하나가 보통 10~20조각이라 넉넉하다. */
const GLOSS_CACHE_MAX = 400

/** 재생 가능한 수어 데이터 + 동작으로 표현하지 못한 낱말(낱말 카드로 띄운다). */
export type Playable = SignData & { gloss_missing?: string[] }

/** 어느 자리의 문장인가 — 번역기를 고르는 데 쓴다.
 *
 *  `disaster`  재난문자·행동요령. 학습 모델이 사전을 크게 앞선다(글로스 F1 18.7 → 55.8).
 *  `everyday`  창구 대화·자유 입력. 모델이 배운 적 없는 말투라 **사전이 낫다.**
 *
 *  기본값을 `everyday`로 둔 것은 안전 때문이다 — 모르는 자리에서는 덜 틀리는 쪽을 쓴다. */
export type Domain = 'disaster' | 'everyday' 

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
  /** 문장을 수어로 재생한다. gloss를 주면 번역을 건너뛰고 그대로 합성한다.
   *  domain은 번역기 선택에 쓴다(재난문자만 학습 모델). */
  play(text: string, gloss?: string[], domain?: Domain): Promise<Playable | null>
  /** 이미 만들어 둔 데이터를 재생한다(캐시된 문장 되풀기). */
  playData(d: Playable): void
  /** 처음부터 다시 */
  restart(): void
  /** 동작 사전 색인 — 단어 검색 화면이 쓴다. */
  bank(): Promise<BankIndex | null>
  /** 문장을 만들되 재생하지는 않는다(미리 만들어 두기). */
  compose(text: string, gloss?: string[], domain?: Domain): Promise<Playable | null>
  /** 곧 쓸 글로스 조각을 미리 받아 둔다(창구에 들어설 때 그 장소의 문구들). */
  prewarm(glosses: string[]): void
  /** 직전 번역을 무엇이 했는가 — 계측용.
   *  모델이 안 뜨면 조용히 사전으로 떨어지는데 화면상 차이가 없어 재지 않으면 모른다. */
  backend: 'nn' | 'dict' | 'rule'
}

export function useSignPlayer(): SignPlayer {
  const [data, setData] = useState<Playable | null>(null)
  /** 직전 번역을 무엇이 했는지 — nn(학습 모델) · dict(통계 사전) · rule(최후 수단). */
  const [backend, setBackend] = useState<'nn' | 'dict' | 'rule'>('rule')
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

  // **번역기는 학습 모델을 먼저 쓴다.** 모델 파일이 없거나 실패하면 그 안에서
  // 통계 사전으로 되돌아간다(NnSignAgent가 스스로 폴백한다) — 배포본에 모델을
  // 안 실어도 앱은 그대로 동작한다.
  const agentRef = useRef<NnSignAgent | null>(null)
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
    async (text: string, gloss?: string[], domain: Domain = 'everyday'): Promise<Playable | null> => {
      const index = await bank()
      if (!index) return null
      // 글로스를 직접 준 문구(장소 상용구)는 번역을 거치지 않는다 — 사람이 확정한 매핑이다.
      if (gloss?.length) return composeGlosses(text, gloss, index, loadGloss)

      // **발신 기관명은 번역하지 않는다.** 재난문자의 22%가 `[행정안전부]`·
      // `[전라남도청]`처럼 보낸 곳 이름으로 시작하는데, 그건 알림의 머리말이지
      // 전할 내용이 아니다. 번역에 넣으면 문장마다 엉뚱한 수어가 앞에 붙는다
      // (실측: `[행정안전부]` → `다스리다1`). 자막에는 원문 그대로 남는다 —
      // 누가 보냈는지는 화면에서 읽을 수 있어야 한다.
      const body = text.replace(/^\s*\[[^\]]{1,20}\]\s*/, '') || text

      /** 번역 결과를 동작으로 — 어느 번역기를 썼든 마무리는 같다. */
      const finish = async (r: { gloss: string[]; unmatched?: string[] }) => {
        const composed = r.gloss.length
          ? await composeGlosses(text, r.gloss, index, loadGloss)
          : null
        // 번역에서 빠진 낱말(지명 등)도 낱말 카드로 — 정보가 조용히 사라지면 안 된다.
        if (composed && r.unmatched?.length) {
          composed.gloss_missing = [
            ...new Set([...(composed.gloss_missing ?? []), ...r.unmatched]),
          ]
        }
        // 한 낱말도 표현 못 하는 문장 — 동작은 없지만 **낱말은 남긴다.** 빈 화면보다
        // "이 말들은 수어로 못 보여드려요"가 정확하고, 상대에게 보여줄 것도 남는다.
        if (!composed && r.unmatched?.length) {
          return {
            korean_text: text, fps: 30, num_frames: 1, gloss_sequence: [],
            keypoints: { pose: [[]], hand_left: [[]], hand_right: [[]] },
            gloss_missing: [...new Set(r.unmatched)],
          } as Playable
        }
        return composed
      }
      // **학습 모델은 재난문자에서만 쓴다.**
      //
      // 모델은 재난안전 말뭉치 200,874쌍으로만 배웠다. 그 안에서는 사전을 크게
      // 앞서지만(글로스 F1 18.7 → 55.8), **밖에서는 자신 있게 틀린다**(실측):
      //
      //     화장실이 어디예요 → 꽃 꽃 지도 지시# 물 준비 가능 높다
      //     도와주세요       → 지역 금요일 금요일 경기 지역 …
      //
      // 무너진 모양이 아니라 그냥 틀린 것이라 출력만 보고는 거를 수 없다.
      // 창구·일상에서는 사전이 훨씬 낫다(낱말 표현률 92.3% · 96.9%).
      // 그래서 **부르는 쪽이 어느 자리인지 알려 준다.** 모르면 사전이 기본이다.
      if (domain !== 'disaster') {
        if (!dictRef.current) dictRef.current = new DictSignAgent()
        const r = await dictRef.current.convert(body)
        setBackend(dictRef.current.lastBackend)
        return finish(r)
      }
      if (!agentRef.current) {
        agentRef.current = new NnSignAgent()
        // 모델이 **재생할 수 있는 낱말만** 고르게 한다. 못 보여줄 낱말을 고르면
        // 아바타가 그 자리를 조용히 건너뛴다 — 화면상 정상처럼 보이는 실패다.
        agentRef.current.setPlayable(Object.keys(index))
      }
      const r = await agentRef.current.convert(body)
      // **무엇이 번역했는지 밖으로 내보낸다.** 모델이 안 뜨면 사전이 대신 답하는데,
      // 화면상으로는 아무 차이가 없다(실측: ORT 진입점이 달라 wasm을 404로 못 찾아
      // 30MB짜리 모델이 한 번도 안 쓰이고 있었다). 오류도 안 나므로 재지 않으면
      // 영영 모른다.
      setBackend(agentRef.current.lastBackend)
      return finish(r)
    },
    [bank, loadGloss],
  )

  /** 곧 쓸 조각을 미리 받아 둔다.
   *
   *  실측: 처음 누른 문구는 조각을 받느라 약 2초, 이미 받아 둔 문구는 0.45초 만에
   *  수어가 시작된다. 창구에 들어서면 그 장소에서 쓸 문구는 **이미 정해져 있으므로**
   *  미리 받아 두면 모든 카드가 빠른 쪽이 된다. 조용히, 실패해도 그만인 작업이다. */
  const prewarm = useCallback((glosses: string[]) => {
    void (async () => {
      const index = await bank()
      if (!index) return
      for (const g of [...new Set(glosses)]) {
        const entry = index[g]
        if (!entry || cacheRef.current.has(g)) continue
        try {
          await loadGloss(g, entry)
        } catch {
          /* 미리 받기는 실패해도 재생 때 다시 시도한다 */
        }
      }
    })()
  }, [bank, loadGloss])

  const playData = useCallback((d: Playable) => {
    setData(d)
    frameRef.current = 0
    setFrame(0)
    setPlaying(true)
  }, [])

  const play = useCallback(
    async (text: string, gloss?: string[], domain: Domain = 'everyday'): Promise<Playable | null> => {
      setBusy(true)
      try {
        const composed = await compose(text, gloss, domain)
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
  //
  // **지난 시간만큼 건너뛴다.** 한 틱에 한 프레임씩만 넘기면, 화면이 느린 기기에서
  // 수어가 슬로모션이 된다. 실측에서 소프트웨어 렌더링 환경이 초당 4틱밖에 못 돌아
  // 20초짜리 문장이 5분이 됐다. 수어는 **속도가 뜻의 일부**라(빠르게=급하게,
  // 느리게=천천히) 느려지는 것은 단순한 성능 문제가 아니라 정확성 문제다.
  // 저사양 폰·키오스크에서도 실제 속도를 지키도록 프레임을 건너뛴다.
  useEffect(() => {
    if (!playing || !data) return
    lastRef.current = 0
    const interval = 1000 / data.fps / speedRef.current
    const step = (ts: number) => {
      if (!playingRef.current) return
      if (lastRef.current === 0) lastRef.current = ts
      const elapsed = ts - lastRef.current
      if (elapsed >= interval) {
        // 한 번에 너무 많이 건너뛰면 동작이 튄다 — 탭 전환 등으로 길게 멈췄다 돌아온
        // 경우를 대비해 상한을 둔다(그때는 조금 느려도 이어지는 편이 낫다).
        const advance = Math.min(Math.floor(elapsed / interval), 6)
        lastRef.current += advance * interval
        const next = frameRef.current + advance
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
      .map((g) => glossLabel(g.gloss))
      .join(' ')
  }, [data, time])

  return {
    backend,
    data, frame, playing, busy, nowGloss, time, speed,
    setSpeed, setPlaying, play, playData, restart, bank, compose, prewarm,
  }
}

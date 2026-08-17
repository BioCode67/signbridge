/**
 * 오프라인 준비 — 회선이 끊긴 자리에서도 대화가 되도록 미리 받아 둔다.
 *
 * **왜.** 서비스워커는 **지나간 응답만** 캐시한다. 그래서 집에서 앱을 설치하고 병원
 * 지하 접수창구에서 처음 "어디가 아픕니까?"를 누르면, 그 동작 조각은 받은 적이 없고
 * 지하라 회선도 없어 아바타가 가만히 서 있는다. 재난이면 더하다 — 기지국이 먼저
 * 죽는데 그때 오는 문자를 번역해야 한다. 그래서 "쓰기 전에" 받아 둔다.
 *
 * 두 단
 *   필수 — 창구 상용구 글로스 + 고빈도 어휘 300종 + 사전(약 7MB).
 *          첫 방문 뒤 **조용히** 받는다(사용자에게 묻지 않는다. 물어서 얻을 답이 없다).
 *   전체 — 고빈도 1,200종 + 아바타(약 33MB). 사용자가 눌러야 받는다(데이터 요금).
 *
 * 받는 방법은 그냥 `fetch`다 — 서비스워커의 cache-first 핸들러가 지나가는 응답을
 * 캐시에 넣기 때문에, 따로 Cache API를 만질 필요가 없다. 서비스워커가 없는 브라우저
 * (iOS 사파리 사생활 모드 등)에서는 HTTP 캐시에만 남아 효과가 약하다 — 그건 정직하게
 * `supported=false`로 알린다.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export type OfflineLevel = 'none' | 'essential' | 'full'

interface Manifest {
  essential: string[]
  extended: string[]
  bytes: { essential: number; extended: number }
  phrases: number
}

export interface OfflineReady {
  /** 서비스워커가 살아 있어 캐시가 실제로 남는가 */
  supported: boolean
  /** 지금까지 어디까지 받아 뒀는가 */
  level: OfflineLevel
  /** 내려받는 중인가 */
  busy: boolean
  /** 0~100 */
  percent: number
  /** 전체 준비에 드는 용량(MB) — 버튼에 적어 사용자가 알고 누르게 한다 */
  fullMb: number
  /** 실패한 파일 수 — 0이 아니면 완전하지 않다고 알린다 */
  failed: number
  /** 전체 준비를 시작한다 */
  prepareFull(): void
}

const KEY = 'sb-offline'
/** 동시 요청 수. 너무 크면 모바일 회선에서 되레 느려지고 서버도 흔들린다. */
const CONCURRENCY = 6

export function useOfflineReady(): OfflineReady {
  // 초기값으로 판정한다 — effect에서 setState하면 첫 렌더가 두 번 돈다.
  const [supported] = useState(() => typeof navigator !== 'undefined' && 'serviceWorker' in navigator)
  const [level, setLevel] = useState<OfflineLevel>(() => {
    const v = localStorage.getItem(KEY)
    return v === 'full' || v === 'essential' ? v : 'none'
  })
  const [busy, setBusy] = useState(false)
  const [percent, setPercent] = useState(0)
  const [failed, setFailed] = useState(0)
  const [fullMb, setFullMb] = useState(0)
  const manifestRef = useRef<Manifest | null>(null)
  const runningRef = useRef(false)

  const manifest = useCallback(async (): Promise<Manifest | null> => {
    if (manifestRef.current) return manifestRef.current
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}data/offline.json`)
      if (!res.ok) return null
      manifestRef.current = (await res.json()) as Manifest
      return manifestRef.current
    } catch {
      return null
    }
  }, [])

  /** 목록을 정해진 동시 수로 나눠 받는다. 실패는 세고 넘어간다(하나 때문에 멈추면 안 된다). */
  const download = useCallback(async (files: string[], reached: OfflineLevel) => {
    if (runningRef.current || files.length === 0) return
    runningRef.current = true
    setBusy(true)
    setPercent(0)
    let done = 0
    let bad = 0
    const base = import.meta.env.BASE_URL
    const queue = [...files]

    const worker = async () => {
      for (;;) {
        const file = queue.shift()
        if (!file) return
        try {
          const res = await fetch(base + file.replace('./', ''), { cache: 'no-cache' })
          if (!res.ok) bad++
          // 본문을 끝까지 읽어야 서비스워커가 캐시에 넣는다 — 헤더만 받고 버리면 안 된다.
          else await res.arrayBuffer()
        } catch {
          bad++
        }
        done++
        setPercent(Math.round((done / files.length) * 100))
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))

    setFailed(bad)
    // 절반 이상 실패했으면 준비됐다고 말하지 않는다 — 거짓 안심이 더 위험하다.
    if (bad < files.length / 2) {
      setLevel(reached)
      localStorage.setItem(KEY, reached)
    }
    setBusy(false)
    runningRef.current = false
  }, [])

  // 필수 세트는 첫 방문 뒤 조용히. 화면이 한가해질 때까지 기다린다(첫 화면을 늦추지 않는다).
  useEffect(() => {
    if (level !== 'none') return
    let cancelled = false
    const start = () => {
      void (async () => {
        const m = await manifest()
        if (!m || cancelled) return
        setFullMb(Math.round(((m.bytes.essential + m.bytes.extended) / 1024 / 1024) * 10) / 10)
        await download(m.essential, 'essential')
      })()
    }
    // requestIdleCallback이 없는 브라우저(사파리)는 타이머로 대신한다.
    const idle = (window as unknown as {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number
    }).requestIdleCallback
    const id = idle ? idle(start, { timeout: 8000 }) : window.setTimeout(start, 4000)
    return () => {
      cancelled = true
      if (!idle) window.clearTimeout(id as number)
    }
  }, [level, manifest, download])

  // 용량 표시는 준비 상태와 무관하게 필요하다(버튼 문구).
  useEffect(() => {
    if (fullMb > 0) return
    void manifest().then((m) => {
      if (m) setFullMb(Math.round(((m.bytes.essential + m.bytes.extended) / 1024 / 1024) * 10) / 10)
    })
  }, [fullMb, manifest])

  const prepareFull = useCallback(() => {
    void (async () => {
      const m = await manifest()
      if (!m) return
      // 필수를 아직 못 받았으면 함께 받는다 — 순서를 따로 관리할 이유가 없다.
      const files = level === 'none' ? [...m.essential, ...m.extended] : m.extended
      await download(files, 'full')
    })()
  }, [manifest, download, level])

  return { supported, level, busy, percent, fullMb, failed, prepareFull }
}

import { useEffect, useState } from 'react'
import type { SignData } from './signTypes'

export interface SignSentence extends SignData {
  /** Source filename, useful as a stable key. */
  file: string
}

type LoadState =
  | { status: 'loading'; sentences: [] }
  | { status: 'ready'; sentences: SignSentence[] }
  | { status: 'error'; sentences: []; message: string }

/**
 * Dynamically loads every sentence listed in `public/data/manifest.json`.
 *
 * Adding a new sentence is zero-code: drop `sign_N.json` into `public/data/`
 * and add its filename to `manifest.json` — a new tab appears automatically.
 */
export function useSignData(enabled = true): LoadState {
  const [state, setState] = useState<LoadState>({ status: 'loading', sentences: [] })

  useEffect(() => {
    // **필요할 때 받는다.** 수록 문장 17개는 합쳐 약 15MB다. 예전에는 소개 페이지를 여는
    // 순간 전부 받아서, 폰으로 첫 화면만 보고 나가는 방문자도 8초 안에 22MB를 썼다(실측).
    if (!enabled) return
    let disposed = false
    const base = import.meta.env.BASE_URL

    async function load() {
      try {
        const manifestRes = await fetch(`${base}data/manifest.json`)
        if (!manifestRes.ok) throw new Error(`manifest.json (${manifestRes.status})`)
        const files: string[] = await manifestRes.json()

        const sentences = await Promise.all(
          files.map(async (file) => {
            const res = await fetch(`${base}data/${file}`)
            if (!res.ok) throw new Error(`${file} (${res.status})`)
            const json = (await res.json()) as SignData
            return { ...json, file }
          }),
        )

        if (!disposed) setState({ status: 'ready', sentences })
      } catch (err) {
        if (!disposed) {
          setState({
            status: 'error',
            sentences: [],
            message: err instanceof Error ? err.message : '데이터를 불러오지 못했습니다.',
          })
        }
      }
    }

    load()
    return () => {
      disposed = true
    }
  }, [enabled])

  return state
}

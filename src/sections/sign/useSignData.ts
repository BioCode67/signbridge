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
export function useSignData(): LoadState {
  const [state, setState] = useState<LoadState>({ status: 'loading', sentences: [] })

  useEffect(() => {
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
  }, [])

  return state
}

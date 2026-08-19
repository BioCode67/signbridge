import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'

/**
 * Live KOREN network telemetry (demo simulation). Makes the network usage of
 * the service tangible: end-to-end latency, per-POP RTT to the 10 NIA POPs,
 * backbone throughput, simultaneous channels. Reinforces that this is a
 * KOREN-utilising real-time distribution service, not a standalone web page.
 */

const POPS = [
  { city: 'AI Network Lab(판교)', base: 1.2, hub: true },
  { city: '서울', base: 2.1 },
  { city: '대전', base: 3.4 },
  { city: '대구', base: 5.2 },
  { city: '부산', base: 6.8 },
  { city: '광주', base: 5.9 },
  { city: '인천', base: 2.6 },
  { city: '수원', base: 1.9 },
  { city: '강릉', base: 6.1 },
  { city: '제주', base: 8.7 },
]

function jitter(base: number, amp: number) {
  return base + (Math.random() - 0.5) * amp
}

export default function NetworkPanel() {
  const [e2e, setE2e] = useState(0.42)
  const [tput, setTput] = useState(6.4)
  const [rtts, setRtts] = useState(() => POPS.map((p) => p.base))
  const tick = useRef(0)

  useEffect(() => {
    const id = setInterval(() => {
      tick.current++
      setE2e(Number(jitter(0.42, 0.06).toFixed(3)))
      setTput(Number(jitter(6.4, 1.6).toFixed(1)))
      setRtts(POPS.map((p) => Number(jitter(p.base, p.base * 0.25).toFixed(1))))
    }, 1500)
    return () => clearInterval(id)
  }, [])

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="mt-12"
    >
      <div className="mb-4 flex items-center justify-center gap-2 text-center">
        <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
          KOREN 실시간 네트워크
        </span>
        <span className="flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-300">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> LIVE · 데모 시뮬레이션
        </span>
      </div>

      <div className="grid gap-4 rounded-2xl border border-white/10 bg-space-900/40 p-5 sm:p-6 lg:grid-cols-[1.1fr_1.4fr]">
        {/* Key metrics */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { v: `${e2e.toFixed(3)}s`, l: '종단 지연 (입력→송출)', big: true },
            { v: '95%↓', l: '영상 대비 대역폭 절감' },
            { v: '10개소', l: '동시 송출 NIA POP' },
            { v: `${tput.toFixed(1)} Gbps`, l: 'KOREN 백본 처리량' },
          ].map((m) => (
            <div
              key={m.l}
              className={`rounded-xl border border-white/10 bg-space-800/50 p-4 ${m.big ? 'col-span-2' : ''}`}
            >
              <div className={`font-extrabold tracking-tight text-cyan-soft ${m.big ? 'text-3xl' : 'text-xl'}`}>
                {m.v}
              </div>
              <div className="mt-1 text-[11px] text-slate-400">{m.l}</div>
            </div>
          ))}
        </div>

        {/* Per-POP RTT */}
        <div className="rounded-xl border border-white/10 bg-space-800/30 p-4">
          <div className="mb-3 flex items-center justify-between text-[11px] text-slate-500">
            <span>NIA POP 노드 · 실시간 RTT</span>
            <span>KOREN 저지연 백본</span>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-2">
            {POPS.map((p, i) => (
              <div key={p.city} className="flex items-center justify-between gap-2 text-xs">
                <span className={`flex items-center gap-2 truncate ${p.hub ? 'text-cyan-soft' : 'text-slate-300'}`}>
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                  {p.city}
                </span>
                <span className="shrink-0 font-mono tabular-nums text-slate-400">{rtts[i].toFixed(1)}ms</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="mx-auto mt-4 max-w-2xl text-center text-xs leading-relaxed text-slate-500">
        재난 텍스트 입력 → AI Network Lab(판교) HPC·GPU에서 수어 아바타 생성 → KOREN 저지연 백본으로
        전국 NIA POP 10개소에 동시 송출. 본 지표는 시연용 시뮬레이션이며, 실증 단계에서 KOREN 실회선으로 대체됩니다.
      </p>
    </motion.div>
  )
}

import { AnimatePresence, motion } from 'framer-motion'
import { Suspense, lazy, useEffect, useState } from 'react'
import Button from '../ui/Button'

// Lazy-load the WebGL scene so the text/LCP paints immediately.
const HeroScene = lazy(() => import('../three/HeroScene'))

const ease = [0.22, 1, 0.36, 1] as const

// Rotating sub-headline — each line frames the value from a different angle.
const TAGLINES = [
  '재난의 순간, AI 수어가 모두에게 도달하는 가장 빠른 길.',
  '재난문자를 한국수어로 — 실시간으로 변환해 송출합니다.',
  'KOREN 저지연망으로 전국에, 골든타임 안에 닿습니다.',
  '들을 수 없어 늦게 아는 격차를, 기술로 메웁니다.',
]

export default function Hero() {
  const [line, setLine] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setLine((l) => (l + 1) % TAGLINES.length), 3800)
    return () => clearInterval(id)
  }, [])

  return (
    <section
      id="top"
      className="relative flex min-h-[100svh] w-full items-center overflow-hidden"
    >
      {/* 3D globe — fills the section, sits behind the copy */}
      <div className="absolute inset-0 z-0">
        <Suspense fallback={<div className="h-full w-full bg-space-950" />}>
          <HeroScene />
        </Suspense>
      </div>

      {/* Left-side vignette so the white type stays legible over the globe */}
      <div className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-r from-space-950 via-space-950/80 to-transparent md:via-space-950/55" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-40 bg-gradient-to-t from-space-950 to-transparent" />

      {/* Copy */}
      <div className="relative z-10 mx-auto w-full max-w-content px-6 lg:px-12">
        <div className="max-w-xl">
          <motion.span
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease }}
            className="inline-flex items-center gap-2 rounded-full border border-cyan-glow/30 bg-cyan-glow/10 px-4 py-1.5 text-xs font-medium tracking-wide text-cyan-soft"
          >
            <span className="h-1.5 w-1.5 animate-pulse-glow rounded-full bg-cyan-glow" />
            KOREN 기반 실시간 재난방송 AI 수어 통역
          </motion.span>

          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.1, ease }}
            className="mt-6 text-5xl font-extrabold leading-[1.05] tracking-tight text-white sm:text-6xl md:text-7xl"
          >
            들리지 않아도,
            <br />
            <span className="text-cyan-soft text-glow">닿습니다.</span>
          </motion.h1>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.25, ease }}
            className="mt-6 h-16 max-w-md sm:h-14"
          >
            <AnimatePresence mode="wait">
              <motion.p
                key={line}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.5, ease }}
                className="text-lg leading-relaxed text-slate-200 sm:text-xl"
                style={{ textShadow: '0 2px 16px rgba(3,4,10,0.85)' }}
              >
                {TAGLINES[line]}
              </motion.p>
            </AnimatePresence>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.4, ease }}
            className="mt-10 flex flex-wrap items-center gap-4"
          >
            <Button href="#demo" variant="primary">
              수어 데모 보기
            </Button>
            <Button href="#why" variant="ghost">
              왜 필요한가
            </Button>
          </motion.div>

          {/* Quick stats — the case at a glance */}
          <motion.dl
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.55, ease }}
            className="mt-12 grid max-w-lg grid-cols-3 gap-4 border-t border-white/10 pt-6"
          >
            {[
              { v: '약 44만 명', l: '국내 등록 청각장애인 (복지부 2024)' },
              { v: '수어방송 5%', l: '자막 100% 대비 편성 비율' },
              { v: '1초 이내', l: '목표 종단 지연 (KOREN)' },
            ].map((s) => (
              <div key={s.l}>
                <dt className="text-xl font-extrabold tracking-tight text-cyan-soft sm:text-2xl">
                  {s.v}
                </dt>
                <dd className="mt-1 text-[11px] leading-snug text-slate-400 sm:text-xs">{s.l}</dd>
              </div>
            ))}
          </motion.dl>
        </div>
      </div>

      {/* Scroll hint */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1, duration: 0.8 }}
        className="absolute bottom-8 left-1/2 z-10 -translate-x-1/2"
      >
        <div className="flex flex-col items-center gap-2 text-slate-500">
          <span className="text-[10px] uppercase tracking-[0.3em]">Scroll</span>
          <span className="flex h-9 w-5 items-start justify-center rounded-full border border-slate-600 p-1">
            <span className="h-2 w-1 animate-float-slow rounded-full bg-cyan-soft" />
          </span>
        </div>
      </motion.div>
    </section>
  )
}

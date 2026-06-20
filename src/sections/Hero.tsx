import { motion } from 'framer-motion'
import { Suspense, lazy } from 'react'
import Button from '../ui/Button'

// Lazy-load the WebGL scene so the text/LCP paints immediately.
const GlobeScene = lazy(() => import('../three/GlobeScene'))

const ease = [0.22, 1, 0.36, 1] as const

export default function Hero() {
  return (
    <section
      id="top"
      className="relative flex min-h-[100svh] w-full items-center overflow-hidden"
    >
      {/* 3D globe — fills the section, sits behind the copy */}
      <div className="absolute inset-0 z-0">
        <Suspense fallback={<div className="h-full w-full bg-space-950" />}>
          <GlobeScene />
        </Suspense>
      </div>

      {/* Left-side vignette so the white type stays legible over the globe */}
      <div className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-r from-space-950 via-space-950/70 to-transparent md:via-space-950/40" />
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

          <motion.p
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.25, ease }}
            className="mt-6 max-w-md text-lg leading-relaxed text-slate-300 sm:text-xl"
          >
            재난의 순간, AI 수어가 모두에게 도달하는 가장 빠른 길.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.4, ease }}
            className="mt-10 flex flex-wrap items-center gap-4"
          >
            <Button href="#demo" variant="primary">
              수어 데모 보기
            </Button>
            <Button href="#how" variant="ghost">
              작동 원리
            </Button>
          </motion.div>
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

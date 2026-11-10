import { AnimatePresence, motion } from 'framer-motion'
import { Suspense, lazy, useEffect, useState } from 'react'
import Button from '../ui/Button'

// Lazy-load the WebGL scene so the text/LCP paints immediately.
const HeroScene = lazy(() => import('../three/HeroScene'))

const ease = [0.22, 1, 0.36, 1] as const

// Rotating sub-headline — each line frames the value from a different angle.
// **첫 줄은 고정한다.** 영상의 첫 3초에 무엇을 만든 건지가 전달돼야 한다.
// 나머지는 각도를 바꿔 가며 돈다.
const TAGLINES = [
  '재난문자를 수어로. 수어를 말과 글로. — 양쪽 다 됩니다.',
  '재난의 순간, AI 수어가 모두에게 도달하는 가장 빠른 길.',
  '들을 수 없어 늦게 아는 격차를, 기술로 메웁니다.',
  '재난이 없는 날에도 — 병원·택시·관공서 창구에서 대화가 오갑니다.',
  '서버 없이 브라우저 안에서 — 비행기 모드에서도 답합니다.',
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
      // 폰에서는 **위에서부터** 쌓는다. 가운데 정렬이면 내용이 화면보다 길 때 위로 넘쳐
      // 고정 상단바(약 60px) 밑으로 들어간다 — 실측(375×667)에서 이음 배너가 로고와 겹쳐
      // 글자가 읽히지 않았다. 상단바 높이만큼 비우고 시작한다.
      className="relative flex min-h-[100svh] w-full items-start overflow-hidden pb-12 pt-[76px] md:items-center md:pb-0 md:pt-0"
    >
      {/* 3D globe — fills the section, sits behind the copy.
          WebGL이 안 뜰 때도 hero-fallback-bg 그래디언트가 깔린다. */}
      <div className="absolute inset-0 z-0 hero-fallback-bg">
        <Suspense fallback={<div className="h-full w-full" />}>
          <HeroScene />
        </Suspense>
      </div>

      {/* Left-side vignette so the white type stays legible over the globe */}
      <div className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-r from-space-950 via-space-950/80 to-transparent md:via-space-950/55" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-40 bg-gradient-to-t from-space-950 to-transparent" />

      {/* Copy */}
      <div className="relative z-10 mx-auto w-full max-w-content px-6 lg:px-12">
        <div className="max-w-xl">
          {/* 이음 진입로 — 루트 주소로 들어온 사람이 바로 찾도록 맨 위에 둔다.
              이 주소는 여러 곳에 함께 소개되므로 특정 행사 이름을 넣지 않는다. */}
          <motion.a
            href="#/ieum"
            data-ieum-banner
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease }}
            className="mb-5 flex items-center gap-3 rounded-2xl border-2 border-amber-400/60 bg-amber-400/10 px-4 py-3 backdrop-blur-sm transition-colors hover:bg-amber-400/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
          >
            <span className="text-2xl" aria-hidden>📄</span>
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] font-semibold tracking-wide text-amber-300">
                새 기능 · 이음
              </span>
              <span className="block text-base font-extrabold leading-snug text-white sm:text-lg">
                서류를 수어로 보기 — 영수증·고지서·복약안내문
              </span>
            </span>
            <span className="shrink-0 text-xl font-bold text-amber-300" aria-hidden>→</span>
          </motion.a>

          <motion.span
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease }}
            className="inline-flex items-center gap-2 rounded-full border border-cyan-glow/30 bg-cyan-glow/10 px-4 py-1.5 text-xs font-medium tracking-wide text-cyan-soft"
          >
            <span className="h-1.5 w-1.5 animate-pulse-glow rounded-full bg-cyan-glow" />
            재난문자·창구 대화를 3D 수어 아바타로
          </motion.span>

          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.1, ease }}
            className="mt-4 text-5xl font-extrabold leading-[1.02] tracking-tight text-white sm:mt-6 sm:text-6xl md:text-[5.5rem]"
          >
            들리지 않아도,
            <br />
            <span className="text-gradient-cyan text-glow">닿습니다.</span>
          </motion.h1>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.25, ease }}
            className="mt-4 h-16 max-w-md sm:mt-6 sm:h-14"
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

          {/* **직접 해 보기** — 첫 화면에서 한 번 누르면 재난문자 한 건이 아바타 수어로 나온다.
              이 주소를 여는 사람 다수는 폰으로 들어와 몇 초 안에 판단한다. 소개를 끝까지
              읽고 데모 칸을 찾아 내려가게 하지 않는다 — 받기 화면(#/app)이 첫 문자를 곧바로 튼다. */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.4, ease }}
            className="mt-5 flex flex-col gap-3 sm:mt-10"
          >
            <a
              href="#/app?try=1"
              data-try-cta
              className="group flex w-full items-center gap-4 rounded-2xl bg-gradient-to-r from-cyan-glow to-cyan-deep px-5 py-4 text-white shadow-[0_0_32px_rgba(34,211,238,0.4)] transition-all hover:-translate-y-0.5 hover:shadow-[0_0_44px_rgba(34,211,238,0.6)] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80 active:scale-[0.98] sm:w-auto sm:self-start sm:pr-7"
            >
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/20 text-xl" aria-hidden>
                ▶
              </span>
              <span className="min-w-0">
                <span className="block text-lg font-extrabold leading-tight">직접 해 보기</span>
                <span className="block text-sm font-medium leading-snug text-white/90">
                  재난문자가 수어로 바뀌는 걸 바로 봅니다
                </span>
              </span>
            </a>
            <div className="flex flex-wrap items-center gap-3">
              <Button href="#demo" variant="ghost">
                수어 데모 보기
              </Button>
              <Button href="#why" variant="ghost">
                왜 필요한가
              </Button>
            </div>
          </motion.div>

          {/* Quick stats — the case at a glance */}
          <motion.dl
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.55, ease }}
            className="mt-12 grid max-w-lg grid-cols-3 gap-5 border-t border-white/[0.06] pt-8"
          >
            {[
              // **문제 하나, 성과 둘.** 왜 필요한지를 먼저 두고, 바로 옆에 재어 본
              // 숫자를 붙인다 — 문제만 있으면 기획서, 숫자만 있으면 무슨 소린지 모른다.
              { v: '약 44만 명', l: '국내 등록 청각장애인 (복지부 2024)' },
              { v: '수어 12,833개', l: '실제 농인 수어자 영상에서 만든 동작' },
              { v: '인식 78.2%', l: 'top-1 · 13,576 클래스 (수어자 분리)' },
            ].map((s) => (
              <div key={s.l}>
                <dt className="text-2xl font-extrabold tracking-tight text-cyan-soft sm:text-[1.7rem]">
                  {s.v}
                </dt>
                <dd className="mt-1.5 text-[11px] leading-snug text-slate-500 sm:text-xs">{s.l}</dd>
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
        // 좁은 화면에서는 숨긴다 — 맨 위 배너만큼 본문이 길어져 수치 줄과 겹쳤다(375px 실측 사진).
        className="absolute bottom-8 left-1/2 z-10 hidden -translate-x-1/2 sm:block"
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

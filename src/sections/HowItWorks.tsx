import { motion } from 'framer-motion'
import SectionHeading from '../ui/SectionHeading'

const ease = [0.22, 1, 0.36, 1] as const

const steps = [
  {
    n: '01',
    title: '방송 영상 입력',
    desc: '재난·속보 방송 영상과 음성을 실시간 스트림으로 수신합니다.',
    icon: <path d="M4 6h16v10H4zM2 20h20M9 16v4m6-4v4" />,
  },
  {
    n: '02',
    title: 'KOREN 저지연망',
    desc: '초고속·저지연 연구망으로 0.5초의 골든타임을 지키며 전송합니다.',
    icon: <path d="M5 12a7 7 0 0114 0M8 12a4 4 0 018 0M11 12a1 1 0 012 0M12 12v8" />,
  },
  {
    n: '03',
    title: 'HPC 수어 아바타 생성',
    desc: '고성능 연산으로 한국수어(KSL) 아바타를 실시간 생성합니다.',
    icon: <path d="M7 9c1.5-2 4-2 5 0m-5 4c2.5 3 5.5 3 8 0M12 3a9 9 0 100 18 9 9 0 000-18z" />,
  },
  {
    n: '04',
    title: '전국 동시 송출',
    desc: '다채널로 전국에 동시 송출 — 심야·지역·다발 속보의 공백을 메웁니다.',
    icon: <path d="M12 3v6m0 0l-3-3m3 3l3-3M5 21h14a2 2 0 002-2v-4H3v4a2 2 0 002 2z" />,
  },
]

export default function HowItWorks() {
  return (
    <section id="how" className="section-pad relative bg-space-900/40">
      <div className="mx-auto max-w-content">
        <SectionHeading
          eyebrow="HOW IT WORKS"
          title={
            <>
              흐르는 방송을, <span className="text-cyan-soft text-glow">실시간으로</span> 통역
            </>
          }
          description="미리 만들어 둔 콘텐츠가 아닙니다. 지금 송출되는 방송을 입력받아, 그 자리에서 수어로 변환해 다시 내보냅니다."
        />

        <div className="relative mt-20">
          {/* Connector line (desktop) */}
          <div className="absolute left-0 right-0 top-9 hidden h-px lg:block">
            <div className="relative mx-[12.5%] h-full bg-gradient-to-r from-cyan-glow/10 via-cyan-glow/40 to-cyan-glow/10">
              <motion.span
                className="absolute -top-1 h-2 w-2 rounded-full bg-cyan-soft shadow-[0_0_12px_4px_rgba(34,211,238,0.6)]"
                animate={{ left: ['0%', '100%'] }}
                transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
              />
            </div>
          </div>

          <div className="grid gap-10 lg:grid-cols-4 lg:gap-6">
            {steps.map((s, i) => (
              <motion.div
                key={s.n}
                initial={{ opacity: 0, y: 28 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ duration: 0.6, delay: i * 0.15, ease }}
                className="relative flex flex-col items-center text-center lg:items-start lg:text-left"
              >
                <div className="relative grid h-[4.5rem] w-[4.5rem] place-items-center rounded-2xl border border-cyan-glow/25 bg-space-800 text-cyan-soft shadow-[0_0_30px_rgba(34,211,238,0.12)]">
                  <svg
                    width="30"
                    height="30"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    {s.icon}
                  </svg>
                  <span className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full bg-cyan-glow text-[11px] font-bold text-space-950">
                    {i + 1}
                  </span>
                </div>
                <span className="mt-5 text-xs font-semibold tracking-[0.2em] text-slate-600">
                  STEP {s.n}
                </span>
                <h3 className="mt-1 text-lg font-bold text-white">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{s.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

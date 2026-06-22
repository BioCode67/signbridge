import { motion } from 'framer-motion'
import SectionHeading from '../ui/SectionHeading'

const ease = [0.22, 1, 0.36, 1] as const

const problems = [
  {
    icon: (
      <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    ),
    title: '정보 격차',
    desc: '재난문자·음성 경보는 텍스트와 소리 중심입니다. 한국수어를 모어(母語)로 쓰는 농인에게는 그 즉시 닿지 않습니다.',
  },
  {
    icon: <path d="M12 8v4l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />,
    title: '골든타임의 공백',
    desc: '재난은 심야·지역·동시다발로 발생합니다. 사람 수어통역사가 24시간 전 채널을 실시간으로 감당하기는 어렵습니다.',
  },
  {
    icon: <path d="M5 12h14M13 6l6 6-6 6M3 6v12" />,
    title: 'SignBridge의 해법',
    desc: '재난 텍스트를 AI가 한국수어로 변환해 KOREN 저지연망으로 전국 다채널에 동시 송출 — 사람이 닿지 못한 공백을 메웁니다.',
  },
]

export default function WhySection() {
  return (
    <section id="why" className="section-pad relative bg-space-900/40">
      <div className="mx-auto max-w-content">
        <SectionHeading
          eyebrow="WHY SIGNBRIDGE"
          title={
            <>
              재난 정보, 농인에게는 <span className="text-cyan-soft text-glow">더 늦게</span> 도착합니다
            </>
          }
          description="들을 수 없다는 이유로 안전 정보에서 멀어져선 안 됩니다. SignBridge는 재난의 순간, 한국수어로 가장 빠르게 닿는 길을 만듭니다."
        />

        {/* Highlight stat band */}
        <motion.div
          initial={{ opacity: 0, y: 28 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6, ease }}
          className="glass mx-auto mt-14 grid max-w-4xl grid-cols-1 gap-px overflow-hidden rounded-2xl sm:grid-cols-3"
        >
          {[
            { v: '약 42만 명', l: '국내 등록 청각장애인 (보건복지부)' },
            { v: '2016년~', l: '한국수어법 시행 — 국어와 동등한 공용어' },
            { v: '0.5초', l: '목표 송출 지연 (KOREN 저지연망)' },
          ].map((s) => (
            <div key={s.l} className="bg-space-800/40 px-6 py-7 text-center">
              <div className="text-2xl font-extrabold tracking-tight text-cyan-soft sm:text-3xl">
                {s.v}
              </div>
              <div className="mt-2 text-xs leading-relaxed text-slate-400">{s.l}</div>
            </div>
          ))}
        </motion.div>

        {/* Problem → solution cards */}
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {problems.map((p, i) => (
            <motion.div
              key={p.title}
              initial={{ opacity: 0, y: 28 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.55, delay: i * 0.12, ease }}
              className="relative rounded-2xl border border-white/10 bg-space-800/40 p-7"
            >
              <div className="grid h-12 w-12 place-items-center rounded-xl border border-cyan-glow/25 bg-space-900 text-cyan-soft">
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {p.icon}
                </svg>
              </div>
              <h3 className="mt-5 text-lg font-bold text-white">{p.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{p.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

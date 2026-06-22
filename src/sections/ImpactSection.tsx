import { motion } from 'framer-motion'
import SectionHeading from '../ui/SectionHeading'

const ease = [0.22, 1, 0.36, 1] as const

const cards = [
  {
    tag: '공익적 가치',
    title: '재난 정보의 사각지대 해소',
    desc: '약 44만 등록 청각장애인과 고령 난청 인구가 재난의 순간 한국수어로 정보를 받고, "지금 무엇을 해야 하는가"를 양방향으로 안내받습니다. "들을 수 없어 늦게 아는" 격차를 기술로 메웁니다.',
    icon: <path d="M12 21s-7-4.35-9.5-8.5C.5 8.5 3 4.5 7 5c2 .25 3.5 2 5 4 1.5-2 3-3.75 5-4 4-.5 6.5 3.5 4.5 7.5C19 16.65 12 21 12 21z" />,
  },
  {
    tag: '상용화 경로 (B2G)',
    title: '재난방송 수어 의무를 자동화로',
    desc: '재난방송 수어통역 제공 의무·권고를 24시간 무인 송출로 보완합니다. 지자체·재난방송사·공공기관 도입으로 인력·비용 부담을 줄입니다.',
    icon: <path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6M9 11h.01M15 11h.01" />,
  },
  {
    tag: '확장성',
    title: 'KOREN 전국망 위에서 확장',
    desc: 'KOREN 다채널을 기반으로 교통·의료·행정 안내 등 공공영역으로, 나아가 수어 다국어(국제)로 확장 가능한 플랫폼입니다.',
    icon: <path d="M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c2.5 2.5 4 5.7 4 9s-1.5 6.5-4 9c-2.5-2.5-4-5.7-4-9s1.5-6.5 4-9z" />,
  },
]

const metrics = [
  { v: '95%↓', l: '전송 대역폭 (영상 대비)' },
  { v: '1초 이내', l: '목표 종단 지연' },
  { v: 'BLEU 16.33', l: '목표 수어 번역 정확도' },
  { v: '5+ 채널', l: 'KOREN 다지역 동시 송출' },
]

export default function ImpactSection() {
  return (
    <section id="impact" className="section-pad relative">
      <div className="mx-auto max-w-content">
        <SectionHeading
          eyebrow="IMPACT & 상용화"
          title={
            <>
              기술을 넘어, <span className="text-cyan-soft text-glow">모두의 안전권</span>으로
            </>
          }
          description="SignBridge는 데모를 넘어 실제 도입까지를 설계합니다. 공공의 안전 정보 접근권을 KOREN 위에서 지속 가능한 서비스로 만듭니다."
        />

        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {cards.map((c, i) => (
            <motion.div
              key={c.tag}
              initial={{ opacity: 0, y: 28 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.55, delay: i * 0.12, ease }}
              className="rounded-2xl border border-white/10 bg-space-800/40 p-7"
            >
              <div className="flex items-center gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-xl border border-cyan-glow/25 bg-space-900 text-cyan-soft">
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    {c.icon}
                  </svg>
                </div>
                <span className="text-xs font-semibold uppercase tracking-[0.15em] text-cyan-soft">
                  {c.tag}
                </span>
              </div>
              <h3 className="mt-4 text-lg font-bold text-white">{c.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{c.desc}</p>
            </motion.div>
          ))}
        </div>

        {/* Metric row */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.6, ease }}
          className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/10 sm:grid-cols-4"
        >
          {metrics.map((m) => (
            <div key={m.l} className="bg-space-800/40 px-5 py-6 text-center">
              <div className="text-xl font-extrabold tracking-tight text-cyan-soft sm:text-2xl">
                {m.v}
              </div>
              <div className="mt-1.5 text-xs leading-snug text-slate-400">{m.l}</div>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}

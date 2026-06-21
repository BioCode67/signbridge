import { motion } from 'framer-motion'

/**
 * Lightweight system architecture diagram (responsive SVG) showing the
 * KOREN-centred data flow: disaster input → KOREN low-latency backbone →
 * HPC/GPU AI conversion → sign avatar → nationwide multi-channel output.
 * Built to make the technical structure legible at a glance for reviewers.
 */

const C = {
  box: '#0b1220',
  stroke: '#1a2740',
  accent: '#22d3ee',
  text: '#e8eef7',
  sub: '#7c8ba1',
}

const stages = [
  { x: 40, t: '재난 입력', s: ['재난문자(CBS)', '재난방송·속보'] },
  { x: 248, t: 'KOREN 저지연망', s: ['초저지연 연구망', '전국 백본'], koren: true },
  { x: 456, t: 'AI 수어 변환', s: ['HPC · GPU', 'AI Network Lab'] },
  { x: 664, t: '수어 아바타', s: ['KSL 실시간', '아바타 생성'] },
  { x: 872, t: '다채널 송출', s: ['방송·앱', '전광판·키오스크'] },
]

const BW = 168
const BH = 96
const BY = 40

export default function SystemDiagram() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="mt-12"
    >
      <p className="mb-4 text-center text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
        시스템 구성
      </p>
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-space-900/40 p-4 sm:p-6">
        <svg viewBox="0 0 1080 220" className="h-auto w-full" role="img" aria-label="SignBridge 시스템 구성도">
          <defs>
            <linearGradient id="koren" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#0e7490" />
              <stop offset="1" stopColor="#22d3ee" />
            </linearGradient>
            <marker id="arrow" markerWidth="9" markerHeight="9" refX="6" refY="3" orient="auto">
              <path d="M0 0 L6 3 L0 6 z" fill={C.accent} />
            </marker>
          </defs>

          {/* connectors */}
          {stages.slice(0, -1).map((st, i) => {
            const x1 = st.x + BW
            const x2 = stages[i + 1].x
            const y = BY + BH / 2
            return (
              <g key={`c${i}`}>
                <line x1={x1} y1={y} x2={x2 - 2} y2={y} stroke={C.accent} strokeWidth="1.5" opacity="0.5" markerEnd="url(#arrow)" />
                <circle r="3.5" fill="#a5f3fc">
                  <animate attributeName="cx" from={x1} to={x2 - 2} dur="2.2s" begin={`${i * 0.4}s`} repeatCount="indefinite" />
                  <animate attributeName="cy" values={`${y};${y}`} dur="2.2s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0;1;1;0" dur="2.2s" begin={`${i * 0.4}s`} repeatCount="indefinite" />
                </circle>
              </g>
            )
          })}

          {/* boxes */}
          {stages.map((st) => (
            <g key={st.t}>
              <rect
                x={st.x}
                y={BY}
                width={BW}
                height={BH}
                rx="14"
                fill={st.koren ? 'url(#koren)' : C.box}
                stroke={st.koren ? C.accent : C.stroke}
                strokeWidth={st.koren ? 2 : 1.2}
                opacity={st.koren ? 0.95 : 1}
              />
              <text
                x={st.x + BW / 2}
                y={BY + 38}
                textAnchor="middle"
                fontSize="20"
                fontWeight="700"
                fill={st.koren ? '#04111a' : C.text}
              >
                {st.t}
              </text>
              {st.s.map((line, j) => (
                <text
                  key={line}
                  x={st.x + BW / 2}
                  y={BY + 60 + j * 18}
                  textAnchor="middle"
                  fontSize="13"
                  fill={st.koren ? '#06303a' : C.sub}
                >
                  {line}
                </text>
              ))}
            </g>
          ))}

          {/* nationwide POPs under the output stage */}
          <text x={872 + BW / 2} y={170} textAnchor="middle" fontSize="12" fill={C.sub}>
            전국 NIA POP 10개소
          </text>
          {['서울', '대전', '대구', '부산', '광주'].map((city, i) => {
            const cx = 872 + 14 + i * 35
            return (
              <g key={city}>
                <circle cx={cx} cy={192} r="4" fill={C.accent} />
                <text x={cx} y={210} textAnchor="middle" fontSize="10" fill={C.sub}>
                  {city}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
    </motion.div>
  )
}

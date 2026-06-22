import { motion } from 'framer-motion'
import SectionHeading from '../ui/SectionHeading'
import SystemDiagram from './SystemDiagram'
import NetworkPanel from './NetworkPanel'

const ease = [0.22, 1, 0.36, 1] as const

// The four collaborating AI agents (Agentic AI architecture).
const agents = [
  {
    n: '01',
    title: '재난 판단 에이전트',
    desc: '입력 텍스트가 재난·안전 정보인지 식별하고, 유형(지진·태풍·호우 등)·긴급도(경보/주의보)·대상 지역을 분석해 송출 우선순위와 채널을 결정합니다.',
    icon: <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />,
  },
  {
    n: '02',
    title: '수어 변환 에이전트',
    desc: '한국어 문장을 한국수어 글로스로 번역(Transformer·KoGPT2 기반)하고, 동작·비수지 정보를 3D 관절 좌표(키포인트) 시퀀스로 출력합니다.',
    icon: <path d="M7 11V7a2 2 0 1 1 4 0m0 0V6a2 2 0 1 1 4 0v5m-4-4v4m4-4a2 2 0 1 1 4 0v6a6 6 0 0 1-6 6h-1.5a5 5 0 0 1-3.5-1.5L4 17.5a1.6 1.6 0 0 1 2.3-2.2L8 17" />,
  },
  {
    n: '03',
    title: 'Q&A 대응 에이전트',
    desc: '농인의 질문(대피소 위치·대피 필요 여부 등)을 받아 GPS 위치와 실시간 재난상황을 종합 분석하고, LLM으로 맞춤 대피 안내를 생성해 수어로 응답합니다.',
    icon: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2zM9 10h.01M13 10h.01M17 10h.01" />,
    star: true,
  },
  {
    n: '04',
    title: '송출 제어 에이전트',
    desc: '긴급도에 따라 KOREN망 상의 송출 채널·대역폭 우선순위를 동적으로 배분해, 동시다발 상황에서도 긴급 정보가 지연 없이 전달되도록 제어합니다.',
    icon: <path d="M12 3v6m0 0-3-3m3 3 3-3M5 21h14a2 2 0 0 0 2-2v-4H3v4a2 2 0 0 0 2 2z" />,
  },
]

const korenAssets = [
  'AI Cloud · H200 GPU',
  'HPC(V100) 연산',
  'SDI · SDN/NFV',
  '400Gbps 전용회선',
  'WebRTC · SRT 초저지연',
  'AI Network Lab · 판교',
]

export default function HowItWorks() {
  return (
    <section id="how" className="section-pad relative bg-space-900/40">
      <div className="mx-auto max-w-content">
        <SectionHeading
          eyebrow="AGENTIC AI · HOW IT WORKS"
          title={
            <>
              4개의 AI 에이전트가 <span className="text-cyan-soft text-glow">협업</span>합니다
            </>
          }
          description="단일 번역 모델이 아닙니다. 재난 판단·수어 변환·양방향 Q&A·송출 제어를 담당하는 4개의 AI 에이전트가 KOREN 저지연망 위에서 협업해, 정보를 전달하고 농인의 질문에 직접 응답합니다."
        />

        {/* Four agents */}
        <div className="mt-16 grid gap-6 lg:grid-cols-4">
          {agents.map((a, i) => (
            <motion.div
              key={a.n}
              initial={{ opacity: 0, y: 28 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.55, delay: i * 0.12, ease }}
              className={`relative flex flex-col rounded-2xl border p-6 ${
                a.star
                  ? 'border-cyan-glow/40 bg-cyan-glow/[0.06]'
                  : 'border-white/10 bg-space-800/40'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="relative grid h-12 w-12 place-items-center rounded-xl border border-cyan-glow/25 bg-space-900 text-cyan-soft">
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    {a.icon}
                  </svg>
                </div>
                <span className="text-xs font-bold tracking-[0.2em] text-slate-600">
                  AGENT {a.n}
                </span>
              </div>
              <h3 className="mt-4 flex items-center gap-2 text-base font-bold text-white">
                {a.title}
                {a.star && (
                  <span className="rounded-full bg-cyan-glow px-2 py-0.5 text-[10px] font-bold text-space-950">
                    양방향
                  </span>
                )}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{a.desc}</p>
            </motion.div>
          ))}
        </div>

        {/* Bidirectional Q&A highlight — the key differentiator */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.6, ease }}
          className="mt-8 overflow-hidden rounded-2xl border border-cyan-glow/20 bg-space-900/40 p-6 sm:p-8"
        >
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-soft">
              양방향 재난 대응 — 단순 알림을 넘어
            </span>
            <p className="text-sm leading-relaxed text-slate-300">
              기존 재난 알림은 일방적 정보 전달에 그칩니다. SignBridge는 패닉 상황의 농인이 “지금 무엇을
              해야 하는가”를 묻으면, 수어 아바타가 직접 답합니다.
            </p>
          </div>
          <div className="mt-6 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
            {[
              { t: '농인 질문', s: '“지금 대피해야 하나요?”\n“가까운 대피소는?”', tag: '버튼·텍스트 + GPS' },
              { t: 'Q&A 에이전트', s: 'GPS 위치 · 실시간 재난상황\n분석 → 맞춤 안내 생성', tag: 'LLM 판단' },
              { t: '수어 응답', s: '3D 아바타가 맞춤 대피\n지침을 수어로 응답', tag: 'KOREN 저지연' },
            ].map((step, i) => (
              <div key={step.t} className="flex flex-1 items-center gap-3">
                <div className="flex-1 rounded-xl border border-white/10 bg-space-800/50 p-4">
                  <div className="text-sm font-bold text-cyan-soft">{step.t}</div>
                  <div className="mt-1 whitespace-pre-line text-xs leading-relaxed text-slate-300">
                    {step.s}
                  </div>
                  <div className="mt-2 inline-block rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-slate-500">
                    {step.tag}
                  </div>
                </div>
                {i < 2 && <span className="hidden shrink-0 text-cyan-soft/60 sm:block">→</span>}
              </div>
            ))}
          </div>
        </motion.div>

        {/* Core-tech comparison — bandwidth + latency (proposal / 발표자료) */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.6, ease }}
          className="mt-8 grid gap-4 sm:grid-cols-2"
        >
          {/* Bandwidth */}
          <div className="rounded-2xl border border-white/10 bg-space-900/40 p-6">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-soft">
              전송 대역폭 — 영상이 아닌 관절 좌표
            </span>
            <div className="mt-4 flex items-end gap-4">
              <div className="flex-1">
                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <span>수어 영상 (FHD)</span>
                  <span>4~8 Mbps</span>
                </div>
                <div className="mt-1 h-2.5 w-full rounded-full bg-slate-600/60" />
                <div className="mt-3 flex items-center justify-between text-[11px] text-cyan-soft">
                  <span>관절 좌표 전송</span>
                  <span>≈ 0.1 Mbps</span>
                </div>
                <div className="mt-1 h-2.5 w-[2%] min-w-[6px] rounded-full bg-cyan-glow" />
              </div>
              <div className="shrink-0 text-right">
                <div className="text-3xl font-extrabold tracking-tight text-cyan-soft">40~80×</div>
                <div className="text-[11px] text-slate-400">대역폭 절감</div>
              </div>
            </div>
            <p className="mt-4 text-[11px] leading-relaxed text-slate-500">
              67개 관절(자세 25 + 양손 42)의 3D 좌표 × 30fps만 전송 — 렌더링은 수신 단말이 담당합니다.
            </p>
          </div>

          {/* Latency */}
          <div className="rounded-2xl border border-white/10 bg-space-900/40 p-6">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-soft">
              종단 지연 — 0.5초 골든타임 사수
            </span>
            <div className="mt-4 space-y-2.5">
              {[
                { n: 'HLS', v: '3~10초', w: '100%', dim: true },
                { n: 'LL-HLS', v: '2~5초', w: '52%', dim: true },
                { n: 'SRT', v: '0.3~0.8초', w: '12%', dim: false },
                { n: 'WebRTC', v: '0.2~0.5초', w: '7%', dim: false },
              ].map((b) => (
                <div key={b.n} className="flex items-center gap-3 text-[11px]">
                  <span className={`w-16 shrink-0 ${b.dim ? 'text-slate-500' : 'font-semibold text-cyan-soft'}`}>
                    {b.n}
                  </span>
                  <div className="h-2.5 flex-1 rounded-full bg-space-800">
                    <div
                      className={`h-full rounded-full ${b.dim ? 'bg-slate-600/70' : 'bg-cyan-glow'}`}
                      style={{ width: b.w }}
                    />
                  </div>
                  <span className={`w-20 shrink-0 text-right ${b.dim ? 'text-slate-500' : 'text-cyan-soft'}`}>
                    {b.v}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-4 text-[11px] leading-relaxed text-slate-500">
              SignBridge는 WebRTC·SRT 채택 (SRT 방송 전송 1위 77%). HLS의 3~10초 버퍼링 지연을 피합니다.
            </p>
          </div>
        </motion.div>

        {/* KOREN utilisation strip — the network is the backbone of this service */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.6, ease }}
          className="mt-8 flex flex-col items-center gap-4 rounded-2xl border border-cyan-glow/20 bg-cyan-glow/[0.04] px-6 py-6 sm:flex-row sm:justify-center sm:gap-3"
        >
          <span className="shrink-0 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-soft">
            KOREN 활용
          </span>
          <div className="flex flex-wrap justify-center gap-2">
            {korenAssets.map((a) => (
              <span
                key={a}
                className="rounded-full border border-white/10 bg-space-800 px-3.5 py-1.5 text-xs text-slate-300"
              >
                {a}
              </span>
            ))}
          </div>
        </motion.div>

        <SystemDiagram />
        <NetworkPanel />
      </div>
    </section>
  )
}

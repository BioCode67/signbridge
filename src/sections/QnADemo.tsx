import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import SectionHeading from '../ui/SectionHeading'

const ease = [0.22, 1, 0.36, 1] as const

/**
 * Interactive demo of the proposal's headline differentiator — the bidirectional
 * Q&A agent. The Deaf user asks (button/FAQ), the agent "analyses" GPS + the live
 * disaster situation, then answers with tailored evacuation guidance rendered as
 * sign-language guidance (gloss). Three disaster scenarios show the breadth.
 * Responses are bundled (faithful to the proposal's phase-1 button/FAQ form);
 * production wires a live LLM over a serverless proxy on KOREN.
 */

interface QA {
  q: string
  a: string
  gloss: string[]
}
interface Scenario {
  id: string
  tab: string
  gps: string
  disaster: string
  tone: 'amber' | 'red' | 'orange'
  qas: QA[]
}

const SCENARIOS: Scenario[] = [
  {
    id: 'flood',
    tab: '🌧️ 호우',
    gps: '서울 관악구 신림동',
    disaster: '호우경보',
    tone: 'amber',
    qas: [
      {
        q: '지금 대피해야 하나요?',
        a: '현재 위치(관악구 신림동)는 도림천 인근 침수 위험 구역입니다. 호우경보가 발효 중이므로 지금 즉시 고지대나 가까운 대피소로 이동하세요. 지하·반지하에서는 바로 나오시고, 차량 이동은 피하세요.',
        gloss: ['지금', '위험', '즉시', '대피', '고지대'],
      },
      {
        q: '가까운 대피소는 어디인가요?',
        a: '가장 가까운 대피소는 신림종합사회복지관(도보 7분·약 320m)입니다. 두 번째는 관악구민체육센터(약 550m)입니다. 침수가 잦은 난곡로 저지대를 피해 큰길로 이동하세요.',
        gloss: ['대피소', '가깝다', '도보', '이동'],
      },
      {
        q: '차량은 어떻게 하나요?',
        a: '지하주차장·하천변 주차는 침수 위험이 큽니다. 차량은 고지대 도로변으로 옮겨 두고 도보로 대피하세요. 침수 도로는 수심 30cm만 넘어도 시동이 꺼질 수 있어 매우 위험합니다.',
        gloss: ['자동차', '위험', '고지대', '도보'],
      },
      {
        q: '정전되면 어떻게 하나요?',
        a: '정전 시 엘리베이터를 타지 말고 계단을 이용하세요. 휴대폰 배터리를 아끼고 긴급 재난문자 수신은 유지하세요. 침수 시 누전 위험이 있으니 차단기(두꺼비집)를 내려 주세요.',
        gloss: ['정전', '금지', '계단', '위험'],
      },
    ],
  },
  {
    id: 'quake',
    tab: '🌐 지진',
    gps: '경북 경주시 황성동',
    disaster: '지진 (규모 5.8)',
    tone: 'red',
    qas: [
      {
        q: '지금 어떻게 해야 하나요?',
        a: '흔들리는 동안에는 책상 아래로 몸을 숨기고 손으로 머리와 목을 보호하세요. 흔들림이 멈추면 가스·전기를 차단하고 운동장·공원 같은 넓은 공터로 대피하세요. 엘리베이터는 절대 사용하지 마세요.',
        gloss: ['지진', '숨다', '머리', '보호', '대피'],
      },
      {
        q: '여진이 또 오나요?',
        a: '규모 5.8 본진 이후 여진이 이어질 수 있습니다. 건물 안보다 운동장·공원 등 탁 트인 공터가 안전합니다. 담장·유리창·간판처럼 무너지거나 떨어질 수 있는 곳에서 멀리 떨어지세요.',
        gloss: ['여진', '위험', '공터', '안전'],
      },
      {
        q: '엘리베이터에 갇혔어요',
        a: '모든 층 버튼을 눌러 가장 먼저 열리는 층에서 내리세요. 문이 열리지 않으면 인터폰이나 119로 침착하게 구조를 요청하고, 무리하게 문을 열려 하지 마세요.',
        gloss: ['엘리베이터', '버튼', '내리다', '구조'],
      },
      {
        q: '가스 냄새가 나요',
        a: '불이나 전등 스위치를 켜지 말고 창문을 열어 환기하세요. 가스 밸브를 잠근 뒤 즉시 건물 밖으로 대피하고, 안전한 곳에서 119에 신고하세요.',
        gloss: ['가스', '금지', '환기', '대피'],
      },
    ],
  },
  {
    id: 'fire',
    tab: '🔥 화재',
    gps: '서울 마포구 합정동',
    disaster: '건물 화재',
    tone: 'orange',
    qas: [
      {
        q: '어떻게 대피하나요?',
        a: '연기를 피해 자세를 최대한 낮추고 젖은 수건으로 코와 입을 막으세요. 계단으로 대피하고 엘리베이터는 타지 마세요. 문손잡이가 뜨거우면 문을 열지 말고 다른 대피로를 찾으세요.',
        gloss: ['화재', '연기', '낮추다', '계단', '대피'],
      },
      {
        q: '연기가 가득해요',
        a: '한 손으로 벽을 짚고 자세를 최대한 낮춰 출구로 이동하세요. 대피가 어려우면 문틈을 옷으로 막아 연기를 차단하고, 창가에서 손전등·천을 흔들어 구조를 요청하세요.',
        gloss: ['연기', '낮추다', '벽', '구조'],
      },
      {
        q: '엘리베이터 타도 되나요?',
        a: '절대 안 됩니다. 화재 시 정전으로 갇힐 수 있고, 엘리베이터 통로로 연기가 빠르게 들어찹니다. 반드시 계단을 이용해 대피하세요.',
        gloss: ['엘리베이터', '금지', '계단'],
      },
      {
        q: '불을 직접 꺼볼까요?',
        a: '초기의 작은 불만 소화기로 대응하고, 불길이 천장에 닿을 만큼 커지면 진화보다 대피가 우선입니다. 대피하면서 “불이야”라고 알리고 119에 신고하세요.',
        gloss: ['소화기', '대피', '알리다', '신고'],
      },
    ],
  },
]

const TONE: Record<Scenario['tone'], string> = {
  amber: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
  red: 'border-red-400/30 bg-red-400/10 text-red-300',
  orange: 'border-orange-400/30 bg-orange-400/10 text-orange-300',
}
const TONE_DOT: Record<Scenario['tone'], string> = {
  amber: 'bg-amber-400',
  red: 'bg-red-400',
  orange: 'bg-orange-400',
}

type Phase = 'idle' | 'thinking' | 'answered'

export default function QnADemo() {
  const [sx, setSx] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [step, setStep] = useState(0)
  const timers = useRef<number[]>([])

  const scenario = SCENARIOS[sx]
  const steps = [
    `GPS 위치 확인 — ${scenario.gps}`,
    `실시간 재난상황 분석 — ${scenario.disaster}`,
    '대피소·안전경로 조회',
    '한국수어 응답 생성',
  ]

  const clearTimers = () => {
    timers.current.forEach((t) => clearTimeout(t))
    timers.current = []
  }
  useEffect(() => () => clearTimers(), [])

  const reset = () => {
    clearTimers()
    setSelected(null)
    setPhase('idle')
    setStep(0)
  }

  const pickScenario = (i: number) => {
    if (i === sx) return
    setSx(i)
    reset()
  }

  const ask = (i: number) => {
    clearTimers()
    setSelected(i)
    setPhase('thinking')
    setStep(0)
    steps.forEach((_, s) => {
      timers.current.push(window.setTimeout(() => setStep(s + 1), 380 * (s + 1)))
    })
    timers.current.push(window.setTimeout(() => setPhase('answered'), 380 * (steps.length + 1)))
  }

  const active = selected !== null ? scenario.qas[selected] : null

  return (
    <section id="qa" className="section-pad relative bg-space-900/40">
      <div className="pointer-events-none absolute right-1/4 top-1/3 -z-0 h-[420px] w-[420px] rounded-full bg-cyan-glow/10 blur-[120px]" />
      <div className="relative mx-auto max-w-content">
        <SectionHeading
          eyebrow="BIDIRECTIONAL Q&A"
          title={
            <>
              직접 물어보세요 — <span className="text-cyan-soft text-glow">수어로 답합니다</span>
            </>
          }
          description="일방적 알림을 넘어, 농인의 질문에 직접 응답합니다. Q&A 대응 에이전트가 GPS 위치와 실시간 재난상황을 분석해 ‘지금 무엇을 해야 하는가’를 맞춤 안내로 — 한국수어로 돌려줍니다."
        />

        {/* Scenario tabs */}
        <div className="mx-auto mt-10 flex max-w-3xl flex-wrap justify-center gap-2">
          {SCENARIOS.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => pickScenario(i)}
              className={`rounded-full border px-4 py-1.5 text-sm transition-all ${
                i === sx
                  ? 'border-cyan-glow bg-cyan-glow/10 text-cyan-soft'
                  : 'border-white/10 bg-space-800 text-slate-400 hover:border-cyan-glow/40 hover:text-slate-200'
              }`}
            >
              {s.tab}
            </button>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 28 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.6, ease }}
          className="mx-auto mt-5 max-w-3xl overflow-hidden rounded-2xl border border-white/10 bg-space-900/50"
        >
          {/* Context bar */}
          <div className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-space-800/50 px-5 py-3 text-xs">
            <span className="flex items-center gap-1.5 rounded-full border border-cyan-glow/30 bg-cyan-glow/10 px-3 py-1 text-cyan-soft">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 21s7-6 7-11a7 7 0 1 0-14 0c0 5 7 11 7 11z" />
                <circle cx="12" cy="10" r="2.5" />
              </svg>
              {scenario.gps}
            </span>
            <span className={`flex items-center gap-1.5 rounded-full border px-3 py-1 ${TONE[scenario.tone]}`}>
              <span className={`h-1.5 w-1.5 animate-pulse rounded-full ${TONE_DOT[scenario.tone]}`} />
              {scenario.disaster} 발효 중
            </span>
            <span className="ml-auto text-slate-500">KOREN 양방향 채널 · LIVE 데모</span>
          </div>

          <div className="grid gap-0 sm:grid-cols-[0.95fr_1.25fr]">
            {/* Question list */}
            <div className="border-b border-white/10 p-5 sm:border-b-0 sm:border-r">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                자주 묻는 질문
              </p>
              <div className="flex flex-col gap-2">
                {scenario.qas.map((qa, i) => (
                  <button
                    key={qa.q}
                    type="button"
                    onClick={() => ask(i)}
                    className={`rounded-xl border px-4 py-3 text-left text-sm transition-all ${
                      selected === i
                        ? 'border-cyan-glow bg-cyan-glow/10 text-cyan-soft'
                        : 'border-white/10 bg-space-800/40 text-slate-300 hover:border-cyan-glow/40 hover:text-white'
                    }`}
                  >
                    {qa.q}
                  </button>
                ))}
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-slate-600">
                ※ 1차 구현은 버튼·텍스트 입력 방식. 향후 수어 인식을 통합해 농인이 수어로 직접 질문하는 완전 양방향으로 확장.
              </p>
            </div>

            {/* Answer thread */}
            <div className="min-h-[260px] p-5">
              {!active && (
                <div className="grid h-full min-h-[220px] place-items-center text-center text-sm text-slate-500">
                  <span>왼쪽에서 질문을 선택하면<br />에이전트가 맞춤 안내를 수어로 응답합니다.</span>
                </div>
              )}

              {active && (
                <div className="flex flex-col gap-4">
                  <div className="self-end rounded-2xl rounded-br-sm border border-cyan-glow/30 bg-cyan-glow/10 px-4 py-2.5 text-sm text-cyan-soft">
                    {active.q}
                  </div>

                  <AnimatePresence mode="wait">
                    {phase === 'thinking' && (
                      <motion.div
                        key="thinking"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="rounded-2xl rounded-bl-sm border border-white/10 bg-space-800/50 px-4 py-3"
                      >
                        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-soft">
                          Q&A 대응 에이전트 분석 중
                        </div>
                        <ul className="flex flex-col gap-1.5">
                          {steps.map((s, si) => (
                            <li
                              key={s}
                              className={`flex items-center gap-2 text-xs transition-colors ${
                                si < step ? 'text-slate-300' : 'text-slate-600'
                              }`}
                            >
                              <span
                                className={`grid h-4 w-4 place-items-center rounded-full text-[9px] ${
                                  si < step ? 'bg-cyan-glow text-space-950' : 'border border-slate-700 text-transparent'
                                }`}
                              >
                                ✓
                              </span>
                              {s}
                              {si === step && (
                                <span className="ml-1 inline-flex gap-0.5">
                                  <span className="h-1 w-1 animate-bounce rounded-full bg-cyan-soft [animation-delay:-0.2s]" />
                                  <span className="h-1 w-1 animate-bounce rounded-full bg-cyan-soft [animation-delay:-0.1s]" />
                                  <span className="h-1 w-1 animate-bounce rounded-full bg-cyan-soft" />
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </motion.div>
                    )}

                    {phase === 'answered' && (
                      <motion.div
                        key="answer"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4, ease }}
                        className="rounded-2xl rounded-bl-sm border border-white/10 bg-space-800/50 px-4 py-3.5"
                      >
                        <div className="mb-2 flex items-center gap-2">
                          <span className="grid h-6 w-6 place-items-center rounded-md bg-cyan-glow/15 text-xs text-cyan-soft">◗</span>
                          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-soft">
                            수어 응답
                          </span>
                          <span className="ml-auto rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-300">
                            KOREN 0.4s
                          </span>
                        </div>
                        <p className="text-sm leading-relaxed text-slate-100">{active.a}</p>
                        <div className="mt-3 flex flex-wrap items-center gap-1.5">
                          <span className="mr-1 text-[10px] text-slate-500">수어 글로스</span>
                          {active.gloss.map((g) => (
                            <span
                              key={g}
                              className="rounded-full border border-cyan-glow/30 bg-cyan-glow/[0.07] px-2.5 py-0.5 text-[11px] text-cyan-soft"
                            >
                              {g}
                            </span>
                          ))}
                        </div>
                        <a
                          href="#demo"
                          className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-cyan-glow/40 bg-cyan-glow/10 px-3.5 py-2 text-xs font-semibold text-cyan-soft transition-colors hover:bg-cyan-glow/20"
                        >
                          수어 아바타로 보기 →
                        </a>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </div>
          </div>
        </motion.div>

        <p className="mx-auto mt-5 max-w-2xl text-center text-xs leading-relaxed text-slate-500">
          위 응답은 시연용으로 사전 구성되었습니다. 실 서비스에서는 Q&A 대응 에이전트(LLM)가 사용자 GPS·실시간 재난·대피소 정보를 종합해 답변을 생성하고, 수어 변환 에이전트가 이를 3D 관절 좌표로 만들어 KOREN 저지연망으로 응답합니다.
        </p>
      </div>
    </section>
  )
}

import { useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import SectionHeading from '../ui/SectionHeading'
import { API_URL } from '../config'
import Button from '../ui/Button'
import { Orchestrator } from '../agents/orchestrator'
import { RuleDisasterAgent } from '../agents/disasterAgent'
import { RuleSignAgent } from '../agents/signAgent'
import { SimBroadcastAgent } from '../agents/broadcastAgent'
import { LlmQAAgent } from '../agents/qaAgent'
import { TemplateBackbone } from '../agents/qaBackbone'
import { KoGPT2Backbone } from '../agents/kogpt2Backbone'
import type { PipelineResult, Severity } from '../agents/types'

/**
 * 4-에이전트 파이프라인 콘솔 (Step3 실증).
 * 재난문자/수어 인식 토큰 + 농인 질문을 입력하면 오케스트레이터가
 * (a)판단 →(b)수어 변환 →(c)Q&A →(d)송출계획을 실제로 계산해 보여준다.
 * 모든 로직은 브라우저 안에서 동작(에이전트 인터페이스는 백엔드로 교체 가능).
 */

interface Preset {
  label: string
  text: string
  question: string
  region: string
}

const PRESETS: Preset[] = [
  {
    label: '🌧️ 호우경보',
    text: '호우경보 발효. 하천변 저지대 침수 위험. 즉시 대피하세요.',
    question: '지금 대피해야 하나요?',
    region: '서울 관악구 신림동',
  },
  {
    label: '🌐 지진',
    text: '경주 규모 5.8 지진 발생. 여진 주의. 흔들림 대비.',
    question: '지금 어떻게 해야 하나요?',
    region: '경북 경주시 황성동',
  },
  {
    label: '🔥 화재',
    text: '건물 화재 발생. 연기 확산. 계단으로 대피 요망.',
    question: '가까운 대피소는 어디인가요?',
    region: '서울 마포구 합정동',
  },
]

const SEV_TONE: Record<Severity, string> = {
  emergency: 'text-red-300 border-red-400/40 bg-red-500/10',
  warning: 'text-orange-300 border-orange-400/40 bg-orange-500/10',
  watch: 'text-amber-300 border-amber-400/40 bg-amber-500/10',
  info: 'text-slate-300 border-white/15 bg-white/5',
}
const SEV_LABEL: Record<Severity, string> = {
  emergency: '긴급',
  warning: '경보',
  watch: '주의',
  info: '정보',
}

export default function AgentConsole() {
  // Q&A 에이전트를 직접 보유해 백본(템플릿 ↔ KoGPT2)을 런타임 교체한다.
  const qaAgentRef = useRef(new LlmQAAgent())
  const orchestrator = useMemo(
    () =>
      new Orchestrator({
        disaster: new RuleDisasterAgent(),
        sign: new RuleSignAgent(),
        qa: qaAgentRef.current,
        broadcast: new SimBroadcastAgent(),
      }),
    [],
  )
  const [preset, setPreset] = useState(0)
  const [text, setText] = useState(PRESETS[0].text)
  const [question, setQuestion] = useState(PRESETS[0].question)
  const [result, setResult] = useState<PipelineResult | null>(null)
  const [busy, setBusy] = useState(false)

  // KoGPT2 백본 토글.
  const [useKoGPT2, setUseKoGPT2] = useState(false)
  const [serverUrl, setServerUrl] = useState(API_URL)
  const [serverOk, setServerOk] = useState<boolean | null>(null)

  const toggleBackbone = async (on: boolean) => {
    setUseKoGPT2(on)
    if (on) {
      const bb = new KoGPT2Backbone(serverUrl)
      qaAgentRef.current.setBackbone(bb)
      setServerOk(null)
      setServerOk(await bb.health())
    } else {
      qaAgentRef.current.setBackbone(new TemplateBackbone())
      setServerOk(null)
    }
  }

  const pick = (i: number) => {
    setPreset(i)
    setText(PRESETS[i].text)
    setQuestion(PRESETS[i].question)
    setResult(null)
  }

  const run = async () => {
    setBusy(true)
    const r = await orchestrator.run({
      text,
      question: question.trim() || undefined,
      geo: { region: PRESETS[preset].region },
    })
    setResult(r)
    setBusy(false)
  }

  return (
    <section id="agents" className="relative border-t border-white/5 py-24 sm:py-32">
      <div className="mx-auto max-w-content px-6 lg:px-12">
        <SectionHeading
          eyebrow="4-에이전트 · Agentic Pipeline"
          title={
            <>
              재난 판단 → 수어 변환 → <span className="text-cyan-soft text-glow">Q&A</span> → 송출
            </>
          }
          description="입력(재난문자 또는 실시간 수어 인식 토큰)과 농인 사용자의 질문을 4개의 에이전트가 순차 처리합니다. 각 단계는 독립 인터페이스라 규칙 기반에서 LLM·실서비스 백엔드로 교체할 수 있습니다."
        />

        <div className="mt-12 grid gap-6 lg:grid-cols-[380px_minmax(0,1fr)]">
          {/* 입력 패널 */}
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p, i) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => pick(i)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    preset === i
                      ? 'border-cyan-glow/60 bg-cyan-glow/10 text-cyan-soft'
                      : 'border-white/15 text-slate-300 hover:border-white/30'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <label className="text-xs font-semibold text-slate-400">
              재난 입력 (재난문자 / 인식 토큰)
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={3}
                className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/40 p-3 text-sm text-slate-100 outline-none focus:border-cyan-glow/50"
              />
            </label>
            <label className="text-xs font-semibold text-slate-400">
              농인 사용자 질문 (선택)
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/40 p-3 text-sm text-slate-100 outline-none focus:border-cyan-glow/50"
              />
            </label>
            <Button onClick={run} variant="primary">
              {busy ? '처리 중…' : '파이프라인 실행 ▶'}
            </Button>

            {/* Q&A 언어 백본 선택 */}
            <div className="rounded-xl border border-white/10 bg-black/30 p-3">
              <label className="flex items-center gap-2 text-xs font-medium text-slate-200">
                <input
                  type="checkbox"
                  checked={useKoGPT2}
                  onChange={(e) => toggleBackbone(e.target.checked)}
                  className="accent-cyan-glow"
                />
                Q&A 백본으로 KoGPT2 사용
                {useKoGPT2 && serverOk !== null && (
                  <span className={serverOk ? 'text-lime-300' : 'text-red-300'}>
                    {serverOk ? '· 서버 연결됨' : '· 서버 응답 없음(템플릿 폴백)'}
                  </span>
                )}
              </label>
              {useKoGPT2 && (
                <input
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  onBlur={() => useKoGPT2 && toggleBackbone(true)}
                  placeholder="http://localhost:8000"
                  className="mt-2 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-cyan-glow/50"
                />
              )}
              <p className="mt-1.5 text-[11px] text-slate-500">
                끄면 오프라인 템플릿 백본. 켜면 로컬 KoGPT2 서버(server/app.py)로 생성, 실패 시 자동
                폴백.
              </p>
            </div>

            <p className="text-xs text-slate-500">
              위치: {PRESETS[preset].region} · 4개 에이전트가 순서대로 실행됩니다.
            </p>
          </div>

          {/* 결과 패널 */}
          <div className="min-h-[320px] rounded-2xl border border-white/10 bg-white/[0.02] p-6">
            {!result ? (
              <div className="grid h-full place-items-center text-sm text-slate-500">
                파이프라인을 실행하면 4-에이전트 처리 결과가 여기에 표시됩니다.
              </div>
            ) : (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="grid gap-4 sm:grid-cols-2"
              >
                {/* (a) 판단 */}
                <AgentCard step="a" title="재난 판단" agent="DisasterAgent">
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold text-white">{result.assessment.type}</span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${SEV_TONE[result.assessment.severity]}`}
                    >
                      {SEV_LABEL[result.assessment.severity]}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-slate-300">{result.assessment.summary}</p>
                  <p className="mt-2 text-[11px] text-slate-500">
                    신뢰도 {(result.assessment.confidence * 100).toFixed(0)}%
                  </p>
                </AgentCard>

                {/* (b) 수어 변환 */}
                <AgentCard step="b" title="수어 변환" agent="SignAgent">
                  <div className="flex flex-wrap gap-1.5">
                    {result.sign.gloss.map((g, i) => (
                      <span
                        key={i}
                        className="rounded-md bg-cyan-glow/10 px-2 py-1 text-xs font-medium text-cyan-soft"
                      >
                        {g}
                      </span>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] text-slate-500">{result.sign.gloss.length}개 글로스</p>
                </AgentCard>

                {/* (c) Q&A */}
                <AgentCard step="c" title="양방향 Q&A" agent="QAAgent">
                  {result.qa ? (
                    <>
                      <p className="text-[11px] text-slate-500">Q. {result.qa.question}</p>
                      <p className="mt-1 text-xs leading-relaxed text-slate-200">{result.qa.answer}</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {result.qa.gloss.map((g, i) => (
                          <span key={i} className="rounded bg-white/5 px-1.5 py-0.5 text-[11px] text-lime-300">
                            {g}
                          </span>
                        ))}
                      </div>
                      <p className="mt-2 text-[11px] text-slate-500">백본: {result.qa.backend}</p>
                    </>
                  ) : (
                    <p className="text-xs text-slate-500">질문 없음(단방향 송출)</p>
                  )}
                </AgentCard>

                {/* (d) 송출 */}
                <AgentCard step="d" title="송출 제어" agent="BroadcastAgent">
                  <div className="flex flex-wrap gap-1.5">
                    {result.broadcast.channels.map((c) => (
                      <span key={c} className="rounded-md bg-white/5 px-2 py-1 text-[11px] text-slate-200">
                        {c}
                      </span>
                    ))}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-slate-400">
                    <span>우선순위 P{result.broadcast.priority}</span>
                    <span>POP {result.broadcast.pops.length}개소</span>
                    <span>대역폭 {result.broadcast.bandwidthMbps}Mbps</span>
                    <span>목표지연 {result.broadcast.latencyMsTarget}ms</span>
                  </div>
                </AgentCard>

                <p className="sm:col-span-2 text-right text-[11px] text-slate-500">
                  파이프라인 처리 {result.tookMs}ms
                </p>
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

function AgentCard({
  step,
  title,
  agent,
  children,
}: {
  step: string
  title: string
  agent: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded-md bg-cyan-glow/15 text-xs font-bold text-cyan-soft">
          {step}
        </span>
        <div>
          <div className="text-sm font-semibold text-white">{title}</div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500">{agent}</div>
        </div>
      </div>
      {children}
    </div>
  )
}

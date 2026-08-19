import { useCallback, useRef, useState } from 'react'
import { glossLabel } from '../agents/glossLabel'
import { glossesToKorean } from '../agents/glossToKorean'
import { useSpeechOutput } from '../hooks/useSpeechOutput'
import { motion } from 'framer-motion'
import * as tf from '@tensorflow/tfjs'
import SectionHeading from '../ui/SectionHeading'
import Button from '../ui/Button'
import { useHolistic } from '../recognition/useHolistic'
import { useRecognizer, type ModelStatus } from '../recognition/useRecognizer'
import { buildModel } from '../recognition/model'
import { KSL_LABELS, NUM_CLASSES, CONFIDENCE_THRESHOLD } from '../recognition/labels'
import { FEATURE_DIM, SEQ_LEN, resampleSequence, type LandmarkFrame } from '../recognition/landmarks'
import { Orchestrator } from '../agents/orchestrator'
import { API_URL } from '../config'

/**
 * 실시간 수어 인식 데모 (Step1 랜드마크 추출 + Step2 GRU 분류 + Step4 자막).
 * 웹캠 → MediaPipe Holistic → 랜드마크 → 특징 → GRU → 키워드 → 실시간 자막.
 *
 * 기본 모델은 합성 데이터 학습본(파이프라인 실증용)이라 실제 수어를 인식하지는
 * 못한다. 하단 "자체수집 학습 스튜디오"에서 몇 개 단어를 직접 녹화·학습하면
 * 내 손동작을 실제로 인식한다(브라우저 안에서 학습·추론).
 * 모든 처리는 브라우저 내에서 일어난다(영상 미전송).
 */

const REC_MS = 1500 // 스튜디오 한 샘플 녹화 시간
const MIN_REC_FRAMES = 12

export default function RecognitionDemo() {
  // **수어 → 한국어 → 소리.** 이 데모의 요점은 왕복이다 — 텍스트를 수어로 바꾸는
  // 것은 위 섹션에서 보여줬고, 여기서는 반대 방향을 끝까지 보여준다.
  // 규칙 기반이라 **서버가 필요 없다**(정적 배포·오프라인에서도 그대로 된다).
  const tts = useSpeechOutput()

  // 스튜디오 녹화 캡처용 버퍼/플래그(리렌더 없이 프레임 수집).
  const recordingRef = useRef(false)
  const studioBufRef = useRef<Float32Array[]>([])

  // onFrame이 rec보다 먼저 선언되므로 pushFrame을 ref로 우회(훅 순환 회피).
  const pushFrameRef = useRef<(f: Float32Array | null) => void>(() => {})
  const onFrame = useCallback((_frame: LandmarkFrame, features: Float32Array | null) => {
    pushFrameRef.current(features)
    if (recordingRef.current && features) studioBufRef.current.push(features)
  }, [])

  const holistic = useHolistic({ onFrame })
  const { videoRef, overlayRef, status, stats, error, start, stop } = holistic
  const running = status === 'running'
  const loading = status === 'loading'
  const rec = useRecognizer(running)
  pushFrameRef.current = rec.pushFrame

  // ── 수어 질문 → 답변 → 아바타 수어 응답 (양방향 왕복) ──
  const [qaBusy, setQaBusy] = useState(false)
  const [qaAnswer, setQaAnswer] = useState('')
  const orchestratorRef = useRef<Orchestrator | null>(null)

  // 인식된 글로스열 → 자연스러운 한국어 문장 복원 (서버의 KoBART g2t).
  // 복원문은 의미 드리프트 위험이 있어 **원문 글로스를 항상 병기**한다.
  const [sentence, setSentence] = useState('')
  const [sentenceRisky, setSentenceRisky] = useState(false)
  const [sentenceBusy, setSentenceBusy] = useState(false)
  const restoreSentence = useCallback(async () => {
    if (sentenceBusy || rec.transcript.length === 0) return
    setSentenceBusy(true)
    setSentence('')
    setSentenceRisky(false)
    try {
      const res = await fetch(`${API_URL}/g2t`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gloss: rec.transcript }),
      })
      if (res.ok) {
        const json = await res.json()
        if (json.text) {
          setSentence(json.text)
          // 서버가 왕복 검증(복원문→역번역→원문 대조)으로 매긴 신뢰도.
          // 낮으면 복원문이 뜻을 뒤집었을 수 있다 — 화면이 원문을 앞세운다.
          setSentenceRisky(Boolean(json.low_confidence))
        } else setSentence('(언어 복원 서버가 준비되지 않았습니다)')
      } else setSentence('(서버 오류)')
    } catch {
      setSentence('(언어 복원은 AI 서버가 필요합니다 — 로컬에서 uvicorn server.app:app)')
    } finally {
      setSentenceBusy(false)
    }
  }, [sentenceBusy, rec.transcript])

  const askFromSigns = useCallback(async () => {
    if (qaBusy || rec.transcript.length === 0) return
    setQaBusy(true)
    setQaAnswer('')
    try {
      if (!orchestratorRef.current) orchestratorRef.current = new Orchestrator()
      // 인식 라벨은 "대피1" 꼴이라 뒤의 구분 숫자를 떼고 질문 문장으로 잇는다.
      const tokens = rec.transcript.map(glossLabel)
      const question = tokens.join(' ')
      const result = await orchestratorRef.current.run({ tokens, question })
      const answer = result.qa?.answer ?? result.assessment.summary
      setQaAnswer(answer)
      // 아바타 섹션으로 넘겨 수어로 응답하게 한다.
      window.dispatchEvent(
        new CustomEvent('signbridge:sign-text', { detail: { text: answer } }),
      )
    } finally {
      setQaBusy(false)
    }
  }, [qaBusy, rec.transcript])

  // ── 자체수집 학습 스튜디오 상태 ──
  const samplesRef = useRef<{ label: string; seq: Float32Array }[]>([])
  const [selectedLabel, setSelectedLabel] = useState<string>(KSL_LABELS[0])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [recording, setRecording] = useState(false)
  const [training, setTraining] = useState<string>('') // '' = idle
  const [studioOpen, setStudioOpen] = useState(false)

  const totalSamples = Object.values(counts).reduce((a, b) => a + b, 0)
  const distinctLabels = Object.keys(counts).length

  const record = () => {
    if (!running || recording) return
    studioBufRef.current = []
    recordingRef.current = true
    setRecording(true)
    window.setTimeout(() => {
      recordingRef.current = false
      setRecording(false)
      const frames = studioBufRef.current
      if (frames.length >= MIN_REC_FRAMES) {
        samplesRef.current.push({ label: selectedLabel, seq: resampleSequence(frames, SEQ_LEN) })
        setCounts((c) => ({ ...c, [selectedLabel]: (c[selectedLabel] ?? 0) + 1 }))
      }
    }, REC_MS)
  }

  const train = async () => {
    const samples = samplesRef.current
    const labelsUsed = new Set(samples.map((s) => s.label))
    if (labelsUsed.size < 2) {
      setTraining('⚠ 최소 2개 단어를 각각 2회 이상 녹화하세요')
      window.setTimeout(() => setTraining(''), 2500)
      return
    }
    setTraining('데이터 준비 중…')
    const n = samples.length
    const xs = new Float32Array(n * SEQ_LEN * FEATURE_DIM)
    const ys = new Float32Array(n * NUM_CLASSES)
    samples.forEach((s, i) => {
      xs.set(s.seq, i * SEQ_LEN * FEATURE_DIM)
      ys[i * NUM_CLASSES + KSL_LABELS.indexOf(s.label as (typeof KSL_LABELS)[number])] = 1
    })
    const X = tf.tensor3d(xs, [n, SEQ_LEN, FEATURE_DIM])
    const Y = tf.tensor2d(ys, [n, NUM_CLASSES])
    const model = buildModel()
    const EPOCHS = 40
    await model.fit(X, Y, {
      epochs: EPOCHS,
      batchSize: Math.min(16, n),
      shuffle: true,
      callbacks: {
        onEpochEnd: (epoch, logs) => {
          const acc = (logs?.acc ?? logs?.accuracy ?? 0) as number
          setTraining(`학습 ${epoch + 1}/${EPOCHS} · acc ${acc.toFixed(2)}`)
        },
      },
    })
    X.dispose()
    Y.dispose()
    rec.recognizer.current.setModel(model)
    rec.setStatus('custom')
    rec.clearTranscript()
    setTraining(`✓ 학습 완료 · ${labelsUsed.size}개 단어 · ${n}샘플`)
    window.setTimeout(() => setTraining(''), 3000)
  }

  const resetStudio = () => {
    samplesRef.current = []
    setCounts({})
    rec.reloadDefault()
  }

  const current = rec.current
  const confPct = current ? Math.round(current.confidence * 100) : 0
  const confident = current !== null && current.confidence >= CONFIDENCE_THRESHOLD

  return (
    <section id="live" className="relative border-t border-white/5 py-24 sm:py-32">
      <div className="mx-auto max-w-content px-6 lg:px-12">
        <SectionHeading
          eyebrow="실시간 인식 · Live"
          title={
            <>
              수어를 <span className="text-cyan-soft text-glow">한국어와 소리</span>로
            </>
          }
          description="카메라 앞에서 수어를 하면 낱말을 알아듣고, 한국어 문장으로 이어 소리로 내보냅니다 — 듣는 사람은 말로 듣습니다. MediaPipe가 상반신·양손 관절을 뽑고, AI Hub 16만 클립으로 학습한 트랜스포머(어휘 13,576종)가 낱말을 고릅니다. 영상은 브라우저 안에서만 처리되며 어디로도 전송되지 않습니다."
        />

        <div className="mt-12 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          {/* 카메라 + 오버레이 + 자막 */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-white/10 bg-black/60"
          >
            <video
              ref={videoRef}
              playsInline
              muted
              className="absolute inset-0 h-full w-full -scale-x-100 object-cover opacity-90"
            />
            <canvas ref={overlayRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />

            {/* 실시간 자막 오버레이 */}
            {running && (
              <div className="absolute inset-x-0 bottom-0 space-y-2 bg-gradient-to-t from-black/85 to-transparent p-4 pt-10">
                {current && (
                  <div className="flex items-center gap-3">
                    <span
                      className={`text-3xl font-bold ${confident ? 'text-cyan-soft text-glow' : 'text-slate-400'}`}
                    >
                      {confident ? current.label : '인식 중…'}
                    </span>
                    <div className="flex-1">
                      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                        <div
                          className={`h-full rounded-full transition-all ${confident ? 'bg-cyan-glow' : 'bg-slate-500'}`}
                          style={{ width: `${confPct}%` }}
                        />
                      </div>
                    </div>
                    <span className="tabular-nums text-xs text-slate-400">{confPct}%</span>
                  </div>
                )}
                {rec.transcript.length > 0 && (
                  <p className="text-sm leading-relaxed text-white/90" aria-live="polite">
                    {rec.transcript.join(' · ')}
                  </p>
                )}
              </div>
            )}

            {!running && (
              <div className="absolute inset-0 grid place-items-center bg-black/50 backdrop-blur-sm">
                <div className="flex flex-col items-center gap-4 text-center">
                  <div className="grid h-16 w-16 place-items-center rounded-full border border-cyan-glow/40 bg-cyan-glow/10 text-3xl">
                    📹
                  </div>
                  {loading ? (
                    <p className="text-sm text-slate-300">모델·카메라 준비 중…</p>
                  ) : (
                    <>
                      <p className="max-w-xs text-sm text-slate-300">
                        카메라를 허용하면 실시간으로 손·상반신 랜드마크와 인식 자막이 표시됩니다.
                      </p>
                      <Button onClick={start} variant="primary">
                        카메라 시작
                      </Button>
                    </>
                  )}
                  {error && <p className="max-w-xs text-xs text-red-300">카메라 오류: {error}</p>}
                </div>
              </div>
            )}

            {running && (
              <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-cyan-soft backdrop-blur">
                <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
                LIVE · {stats.fps} fps
              </div>
            )}
          </motion.div>

          {/* 상태 패널 */}
          <div className="flex flex-col gap-4">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">인식 상태</h3>
                <ModelBadge status={rec.modelStatus} />
              </div>
              {/* 인식 모델 선택 — 어떤 모델로 돌고 있는지 숨기지 않는다.
                  합성 모델은 실제 수어를 인식하지 못하므로 그 사실을 명시한다. */}
              <div className="mt-3 flex gap-1">
                {([
                  { id: 'aihub' as const, label: 'AI Hub 학습' },
                  { id: 'synth' as const, label: '합성/자체수집' },
                ]).map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => rec.setBackend(b.id)}
                    aria-pressed={rec.backend === b.id}
                    className={`flex-1 rounded-md border px-2 py-1.5 text-[11px] transition-colors ${
                      rec.backend === b.id
                        ? 'border-cyan-glow bg-cyan-glow/10 font-semibold text-cyan-soft'
                        : 'border-white/10 bg-space-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[10.5px] leading-relaxed text-slate-500">
                {rec.backend === 'aihub'
                  ? rec.aihubInfo
                    ? `실데이터 학습 · 어휘 ${rec.aihubInfo.num_classes.toLocaleString()}종 · 검증 top-1 ${(
                        (rec.aihubInfo.val_top1 ?? 0) * 100
                      ).toFixed(1)}% (수어자 분리)`
                    : rec.loadPct != null ? `실데이터 학습 모델 내려받는 중… ${rec.loadPct}% (20MB, 최초 1회)` : '실데이터 학습 모델을 불러오는 중…'
                  : '합성 데이터 모델 — 실제 수어는 인식하지 못합니다. 스튜디오 녹화·학습용입니다.'}
              </p>

              <dl className="mt-4 space-y-3 text-sm">
                <StatusRow label="상반신 포즈" ok={stats.poseOk} />
                <StatusRow label="왼손 (21관절)" ok={stats.leftOk} />
                <StatusRow label="오른손 (21관절)" ok={stats.rightOk} />
              </dl>
              <div className="mt-4 border-t border-white/10 pt-4 text-xs text-slate-400">
                <div className="flex justify-between">
                  <span>처리 속도</span>
                  <span className="tabular-nums text-slate-200">{stats.fps} fps</span>
                </div>
                <div className="mt-1 flex justify-between">
                  <span>확정 자막</span>
                  <span className="tabular-nums text-slate-200">{rec.transcript.length}개</span>
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              {running ? (
                <Button onClick={stop} variant="ghost">
                  카메라 정지
                </Button>
              ) : null}
              {rec.transcript.length > 0 && (
                <button
                  type="button"
                  onClick={rec.clearTranscript}
                  className="rounded-full border border-white/15 px-4 py-2 text-xs text-slate-300 hover:border-white/30"
                >
                  자막 지우기
                </button>
              )}
            </div>

            {/* ── 수어 → 한국어 → 소리 (서버 없이) ─────────────────────────
                인식된 낱말을 한국어 문장으로 잇고, 그대로 소리로 내보낸다.
                농인이 수어로 말하면 **듣는 사람은 소리로 듣는다** — 창구에서
                실제로 필요한 것이 이것이다. */}
            {/* **항상 보인다.** 수어를 해야 나타나면, 보는 사람은 무엇이 일어날지
                모른 채 기다리게 된다. 빈 상태에서도 세 칸을 보여 주어 흐름이
                먼저 읽히게 한다 — 시연에서 이 차이가 크다. */}
            <div className="rounded-2xl border border-cyan-glow/25 bg-cyan-glow/5 p-4">
              <p className="text-[11px] font-bold uppercase tracking-widest text-cyan-soft/80">
                수어 → 한국어 → 소리
              </p>

              <div className="mt-3 flex min-h-[30px] flex-wrap items-center gap-1.5">
                {rec.transcript.length > 0 ? (
                  rec.transcript.map((g, i) => (
                    <span
                      key={`${g}-${i}`}
                      className="rounded-lg bg-white/10 px-2.5 py-1 text-xs font-bold text-slate-100"
                    >
                      {glossLabel(g)}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-slate-500">
                    ① 카메라 앞에서 수어를 하면 알아들은 낱말이 여기 쌓입니다
                  </span>
                )}
              </div>

              <p
                className={`mt-3 break-keep text-lg font-extrabold leading-snug ${
                  rec.transcript.length > 0 ? 'text-white' : 'text-slate-600'
                }`}
              >
                {rec.transcript.length > 0
                  ? `“${glossesToKorean(rec.transcript)}”`
                  : '② 한국어 문장으로 이어집니다'}
              </p>

              <button
                type="button"
                disabled={!tts.supported || tts.speaking || rec.transcript.length === 0}
                onClick={() => tts.speak(glossesToKorean(rec.transcript))}
                className="mt-3 w-full rounded-xl border border-cyan-glow/40 bg-cyan-glow/10 px-4 py-2.5 text-sm font-bold text-cyan-soft transition-colors hover:bg-cyan-glow/20 disabled:opacity-40"
              >
                {tts.speaking
                  ? '🔊 말하는 중…'
                  : rec.transcript.length > 0
                    ? '🔊 소리로 듣기'
                    : '③ 🔊 소리로 내보냅니다'}
              </button>
              {!tts.supported && (
                <p className="mt-2 text-xs text-slate-500">
                  이 브라우저는 음성 출력을 지원하지 않습니다 (크롬·엣지 권장).
                </p>
              )}
            </div>

            {/* 양방향 왕복 — 인식된 수어를 질문으로 삼아 답을 만들고,
                그 답을 아바타가 다시 수어로 표현한다. 농인↔시스템 대화의 완결이다. */}
            {rec.transcript.length > 0 && (
              <button
                type="button"
                disabled={qaBusy}
                onClick={() => void askFromSigns()}
                className="rounded-xl border border-emerald-400/40 bg-emerald-400/5 px-4 py-3 text-left text-sm font-medium text-emerald-300 transition-colors hover:bg-emerald-400/10 disabled:opacity-50"
              >
                {qaBusy ? '답변 생성 중…' : '🤟 이 수어로 질문 → 아바타가 수어로 응답'}
                <span className="mt-0.5 block text-xs font-normal text-slate-400">
                  인식된 단어를 질문으로 해석해 답변을 만들고, 아바타가 수어로 답합니다
                </span>
              </button>
            )}
            {rec.transcript.length > 0 && (
              <button
                type="button"
                disabled={sentenceBusy}
                onClick={() => void restoreSentence()}
                className="rounded-xl border border-cyan-glow/40 bg-cyan-glow/5 px-4 py-3 text-left text-sm font-medium text-cyan-soft transition-colors hover:bg-cyan-glow/10 disabled:opacity-50"
              >
                {sentenceBusy ? '문장 복원 중…' : '📝 인식된 수어를 문장으로'}
                <span className="mt-0.5 block text-xs font-normal text-slate-400">
                  글로스열을 KoBART가 자연스러운 한국어 문장으로 복원합니다
                </span>
              </button>
            )}
            {sentence && (
              <div
                className={`rounded-lg border px-3 py-2 text-xs leading-relaxed ${
                  sentenceRisky
                    ? 'border-amber-400/40 bg-amber-400/5'
                    : 'border-white/10 bg-space-800/60'
                }`}
              >
                {sentenceRisky ? (
                  <>
                    {/* 왕복 검증에서 뜻이 어긋났다 — 원문을 앞세우고 복원문은 참고로 */}
                    <p className="font-semibold text-amber-300">
                      원문 수어: {rec.transcript.map(glossLabel).join(' · ')}
                    </p>
                    <p className="mt-1 text-slate-400">
                      ⚠️ AI 복원(자체 검증 저신뢰): {sentence}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-slate-200">{sentence}</p>
                    <p className="mt-1 text-[10.5px] text-slate-500">
                      원문 수어: {rec.transcript.map(glossLabel).join(' · ')}
                    </p>
                  </>
                )}
              </div>
            )}
            {qaAnswer && (
              <p className="rounded-lg border border-white/10 bg-space-800/60 px-3 py-2 text-xs leading-relaxed text-slate-300">
                <span className="mr-1 font-semibold text-emerald-300">응답</span>
                {qaAnswer}
              </p>
            )}

            <button
              type="button"
              onClick={() => setStudioOpen((v) => !v)}
              className="rounded-xl border border-cyan-glow/30 bg-cyan-glow/5 px-4 py-3 text-left text-sm font-medium text-cyan-soft transition-colors hover:bg-cyan-glow/10"
            >
              🎓 자체수집 학습 스튜디오 {studioOpen ? '▲' : '▼'}
              <span className="mt-0.5 block text-xs font-normal text-slate-400">
                단어를 직접 녹화·학습해 실제 인식하기
              </span>
            </button>
          </div>
        </div>

        {/* 학습 스튜디오 */}
        {studioOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="mt-6 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02] p-6"
          >
            <div className="grid gap-6 md:grid-cols-[1fr_1fr]">
              <div>
                <h4 className="text-sm font-semibold text-white">1) 단어 녹화 (자체수집)</h4>
                <p className="mt-1 text-xs text-slate-400">
                  카메라를 켠 상태에서 단어를 고르고 <b>녹화</b>를 누른 뒤 {REC_MS / 1000}초 동안
                  해당 수어 동작을 하세요. 단어마다 2회 이상, 최소 2개 단어를 권장합니다.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <select
                    value={selectedLabel}
                    onChange={(e) => setSelectedLabel(e.target.value)}
                    className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-glow/50"
                  >
                    {KSL_LABELS.map((l) => (
                      <option key={l} value={l}>
                        {l}
                        {counts[l] ? ` (${counts[l]})` : ''}
                      </option>
                    ))}
                  </select>
                  <Button onClick={record} variant="primary">
                    {recording ? `녹화 중… ${REC_MS / 1000}s` : '● 녹화'}
                  </Button>
                  {!running && <span className="text-xs text-amber-300">카메라를 먼저 켜세요</span>}
                </div>
                {totalSamples > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {Object.entries(counts).map(([l, c]) => (
                      <span
                        key={l}
                        className="rounded-md bg-white/5 px-2 py-1 text-xs text-slate-200"
                      >
                        {l} <span className="text-cyan-soft">×{c}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h4 className="text-sm font-semibold text-white">2) 학습 & 적용</h4>
                <p className="mt-1 text-xs text-slate-400">
                  수집한 샘플로 브라우저 안에서 GRU를 학습합니다(수 초). 완료되면 위 카메라가 내
                  손동작을 실제로 인식합니다.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button onClick={train} variant="primary">
                    ▶ 학습 시작
                  </Button>
                  <button
                    type="button"
                    onClick={resetStudio}
                    className="rounded-full border border-white/15 px-4 py-2 text-xs text-slate-300 hover:border-white/30"
                  >
                    초기화(기본 모델)
                  </button>
                </div>
                <div className="mt-3 text-xs text-slate-300">
                  <div>
                    수집: <b className="text-cyan-soft">{totalSamples}</b>샘플 · {distinctLabels}단어
                  </div>
                  {training && <div className="mt-1 text-cyan-soft">{training}</div>}
                </div>
              </div>
            </div>
            <p className="mt-4 border-t border-white/10 pt-3 text-[11px] leading-relaxed text-slate-500">
              이 스튜디오는 실서비스에서 AI Hub「재난 수어영상」대규모 라벨 데이터로 학습한 모델을
              대체하는 <b>소규모 자체수집 실증</b>입니다. 동일 특징·모델 구조를 그대로 사용하므로,
              데이터만 교체하면 확장됩니다.
            </p>
          </motion.div>
        )}
      </div>
    </section>
  )
}

function StatusRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-slate-300">{label}</dt>
      <dd
        className={`inline-flex items-center gap-1.5 text-xs font-medium ${ok ? 'text-lime-300' : 'text-slate-500'}`}
      >
        <span className={`h-2 w-2 rounded-full ${ok ? 'bg-lime-400' : 'bg-slate-600'}`} />
        {ok ? '감지됨' : '대기'}
      </dd>
    </div>
  )
}

function ModelBadge({ status }: { status: ModelStatus }) {
  const map: Record<ModelStatus, { text: string; cls: string }> = {
    idle: { text: '모델 대기', cls: 'text-slate-400 border-white/15' },
    loading: { text: '모델 로딩', cls: 'text-amber-300 border-amber-400/30' },
    ready: { text: '기본(합성 실증)', cls: 'text-slate-300 border-white/20' },
    custom: { text: '내 모델 ✓', cls: 'text-cyan-soft border-cyan-glow/40 bg-cyan-glow/10' },
    error: { text: '모델 없음', cls: 'text-red-300 border-red-400/30' },
  }
  const m = map[status]
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${m.cls}`}>{m.text}</span>
}

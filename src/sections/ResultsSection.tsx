import { motion } from 'framer-motion'
import SectionHeading from '../ui/SectionHeading'

/** 실측 성과 — **재어 본 것만** 적는다.
 *
 *  발표 자료에서 가장 흔한 실패가 "목표치를 성과처럼 적는 것"이다. 여기 있는
 *  숫자는 전부 이 저장소의 검사 스크립트가 다시 계산해 낼 수 있는 값이다.
 *  괄호 안에 **무엇으로 쟀는지**를 같이 적는 이유도 그것이다 — 재현되지 않는
 *  숫자는 발표가 끝나는 순간 아무 의미가 없다.
 */
const ease = [0.22, 1, 0.36, 1] as const
const viewport = { once: true, margin: '-60px' }

const HEADLINE = [
  {
    v: '78.2%',
    unit: 'top-1',
    l: '수어 낱말 인식',
    sub: '13,576 클래스 · 수어자 분리',
    note: '처음 보는 수어자 13명에서도 78.6% (49,721표본)',
  },
  {
    v: '27.1',
    unit: 'BLEU-4',
    l: '한국어 → 수어 번역',
    sub: '사람 번역가 정답 기준',
    note: '이전 판 21.9 → 27.1 (같은 검증 800문장)',
  },
  {
    v: '96.1%',
    unit: '',
    l: '재난문자 낱말 표현률',
    sub: '실측 246건',
    note: '행동요령·길찾기는 100%',
  },
  {
    v: '266',
    unit: '개',
    l: '자동 검사 전부 통과',
    sub: '앱 실조작 129 + 오역 회귀 137',
    note: '폰·태블릿(가로/세로)·키오스크·오프라인에서 실제로 눌러 봅니다',
  },
]

const SCALE = [
  { v: '12,833', l: '수어 동작', s: '실제 농인 수어자 영상에서' },
  { v: '230,317', l: '번역 낱말', s: '활용형·조사형 포함' },
  { v: '20만', l: '학습 문장쌍', s: '한국어 ↔ 글로스' },
  { v: '0', l: '서버', s: '전부 브라우저 안에서' },
]

/** 고친 것 — **전/후를 나란히** 둔다. 숫자보다 이쪽이 더 잘 전달된다. */
const FIXED = [
  {
    tag: '행동요령',
    ko: '엘리베이터를 타지 말고 계단으로 대피하세요',
    before: '주말1 기간1 필요1 때1 사람2#',
    after: '엘리베이터1 타다0 계단0 대피0 하지마1',
    why: '목숨이 걸린 안내가 학습 모델의 헛소리로 나가고 있었습니다',
  },
  {
    tag: '부정',
    ko: '약을 안 먹었어요',
    before: '약 먹다',
    after: '약 먹다 아니다0',
    why: '부정이 사라져 뜻이 정반대로 전달됐습니다',
  },
  {
    tag: '몸 상태',
    ko: '다리가 부었어요',
    before: '다리',
    after: '다리 붓다',
    why: '동작이 사전에 있는데도 활용형이 없어 통째로 빠졌습니다',
  },
]

export default function ResultsSection() {
  return (
    <section id="results" className="section-pad relative">
      {/* 은은한 바닥 광원 — 카드가 어두운 배경에서 떠 보이게 한다 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-1/3 -z-10 h-72 bg-[radial-gradient(60%_100%_at_50%_0%,rgba(34,211,238,0.10),transparent)]"
      />
      <div className="mx-auto max-w-content">
        <SectionHeading
          eyebrow="MEASURED · 실측"
          title={
            <>
              목표가 아니라 <span className="text-cyan-soft text-glow">재어 본 숫자</span>
            </>
          }
          description="아래 값은 모두 저장소의 검사 스크립트가 다시 계산해 냅니다. 괄호 안에 무엇으로 쟀는지를 함께 적었습니다."
        />

        {/* ── 대표 지표 넷 */}
        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {HEADLINE.map((m, i) => (
            <motion.div
              key={m.l}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={viewport}
              transition={{ duration: 0.5, delay: i * 0.08, ease }}
              className="rounded-2xl border border-white/10 bg-space-800/40 p-6 transition-colors hover:border-cyan-glow/40"
            >
              <div className="flex items-baseline gap-1.5">
                <span className="text-4xl font-extrabold tracking-tight text-cyan-soft text-glow">
                  {m.v}
                </span>
                {m.unit && (
                  <span className="text-sm font-bold text-cyan-soft/70">{m.unit}</span>
                )}
              </div>
              <p className="mt-3 text-base font-bold text-white">{m.l}</p>
              <p className="mt-1 text-sm text-slate-400">{m.sub}</p>
              <p className="mt-3 border-t border-white/5 pt-3 text-xs leading-relaxed text-slate-500">
                {m.note}
              </p>
            </motion.div>
          ))}
        </div>

        {/* ── 규모 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={viewport}
          transition={{ duration: 0.5, ease }}
          className="mt-6 grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-4"
        >
          {SCALE.map((s) => (
            <div key={s.l} className="bg-space-900 px-6 py-6 text-center">
              <p className="text-2xl font-extrabold text-white">{s.v}</p>
              <p className="mt-1 text-sm font-bold text-cyan-soft">{s.l}</p>
              <p className="mt-1 text-xs text-slate-500">{s.s}</p>
            </div>
          ))}
        </motion.div>

        {/* ── 고친 것: 전/후 */}
        <div className="mt-20">
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="text-xs font-semibold uppercase tracking-[0.25em] text-amber-300/80">
              BEFORE · AFTER
            </span>
            <h3 className="text-2xl font-extrabold text-white sm:text-3xl">
              화면은 멀쩡한데 <span className="text-amber-300">뜻이 틀린</span> 자리를 찾았습니다
            </h3>
            <p className="max-w-2xl text-sm leading-relaxed text-slate-400">
              아바타는 움직이고 자막에는 한국어가 그대로 떠 있습니다. 눈으로는 잡을 수
              없어서, 문장을 넣고 나온 수어를 하나씩 대조해 찾았습니다.
            </p>
          </div>

          <div className="mt-10 grid gap-5 lg:grid-cols-3">
            {FIXED.map((f, i) => (
              <motion.div
                key={f.tag}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={viewport}
                transition={{ duration: 0.5, delay: i * 0.1, ease }}
                className="flex flex-col rounded-2xl border border-white/10 bg-space-800/40 p-6"
              >
                <span className="self-start rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1 text-xs font-bold text-amber-200">
                  {f.tag}
                </span>
                <p className="mt-4 text-base font-bold leading-snug text-white">“{f.ko}”</p>

                <div className="mt-5 space-y-2.5 text-sm">
                  <div className="rounded-xl border border-red-400/20 bg-red-400/5 px-4 py-3">
                    <p className="text-xs font-bold text-red-300/90">전</p>
                    <p className="mt-1 break-keep font-medium text-red-200/90">{f.before}</p>
                  </div>
                  <div className="rounded-xl border border-emerald-400/25 bg-emerald-400/5 px-4 py-3">
                    <p className="text-xs font-bold text-emerald-300/90">후</p>
                    <p className="mt-1 break-keep font-medium text-emerald-200">{f.after}</p>
                  </div>
                </div>

                <p className="mt-4 border-t border-white/5 pt-4 text-xs leading-relaxed text-slate-400">
                  {f.why}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

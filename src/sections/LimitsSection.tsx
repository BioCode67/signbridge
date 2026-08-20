import { motion } from 'framer-motion'
import SectionHeading from '../ui/SectionHeading'

/** 아직 안 되는 것 — **먼저 말한다.**
 *
 *  발표에서 한계를 숨기면 질문 한 번에 무너진다. 먼저 꺼내 놓으면 그 자리가
 *  가장 신뢰받는 대목이 된다. 여기 적은 것은 전부 우리가 **재어 보고 알게 된**
 *  한계이고, 무엇이 있으면 풀리는지까지 같이 적었다.
 */
const ease = [0.22, 1, 0.36, 1] as const
const viewport = { once: true, margin: '-60px' }

const LIMITS = [
  {
    state: '학습은 끝났습니다',
    tone: 'cyan',
    title: '이어서 하는 수어 — 지금은 낱말을 끊어야 합니다',
    body:
      '“머리” 멈춤 “아프다” 멈춤. 농인에게 이건 대화가 아니라 조작입니다. ' +
      '이어서 수어해도 문장으로 읽히는 모델(CTC)을 학습해 두었습니다.',
    found:
      '검증 WER 0.218까지 내렸지만 앱에는 아직 잇지 않았습니다. 이 모델은 클래스가 ' +
      '8,147종이라 배포본 13,576종과 집합이 달라, 그대로 바꾸면 “화장실” 의도가 ' +
      '통째로 죽습니다 — 오류도 경고도 없이.',
    have: ['WER 0.218', '학습 135,446클립', '브라우저 디코더 준비됨'],
    need: '두 모델을 함께 돌릴지, 이어서 수어한 표본을 받아 재고 정합니다',
  },
  {
    state: '길이 열렸다',
    tone: 'amber',
    title: '지문자 — 이름·지명을 손으로 쓰는 것',
    body:
      '사람 이름과 지명에는 수어 단어가 없어 자모를 하나씩 씁니다. 지금은 낱말 카드로 ' +
      '정보 손실만 막아 두었습니다.',
    found:
      '“공개 데이터가 없다”고 알고 있었는데 아니었습니다. 파일명 갈래가 문서의 ' +
      'FINSP가 아니라 FS여서 필터에 0건으로 걸리며 오류도 안 났습니다.',
    have: ['클립 17,000개', '지명 1,015종', '자모 37종 · 133,986회'],
    need: 'AI Hub API 키 → 키포인트 12GB → 자모 CTC 학습',
  },
  {
    state: '지어내지 않기로',
    tone: 'slate',
    title: '표정 — 눈썹·입 모양',
    body:
      '수어에서 표정은 문법입니다. 판정 의문문과 설명 의문문은 눈썹 방향이 반대입니다.',
    found:
      '원본에 8채널이 시간 구간까지 붙어 있습니다. 다만 “어떻게 움직였는지”는 ' +
      '마우징을 빼면 비어 있습니다 — 언제 움직이는지는 알아도 올라갔는지 찌푸렸는지는 모릅니다.',
    have: ['고개 끄덕임 9종', '고개 흔들기 7종', '마우징 225종'],
    need: '뜻이 분명한 것만 씁니다. 눈썹 방향은 규칙으로 지어내지 않습니다',
  },
  {
    state: '9월에 잽니다',
    tone: 'cyan',
    title: '자연스러운가 — 아직 아무것도 못 재고 있습니다',
    body:
      '표현률과 BLEU는 “낱말이 나갔나 / 맞게 나갔나”까지만 잽니다. ' +
      '농인이 보고 뜻이 통하는지는 다른 질문입니다.',
    found:
      '잘못된 수어는 표현되지 않은 것보다 나쁩니다 — 농인은 그것을 믿기 때문입니다. ' +
      '그래서 커버리지 숫자를 성과로 내세우지 않습니다.',
    have: ['오역 회귀 사례 145건', '수어 의도 27건 오검출 0', '자동 검사 266개'],
    need: '농아인협회·복지관 당사자 평가 (2026년 9월)',
  },
]

const TONE: Record<string, { chip: string; bar: string }> = {
  amber: {
    chip: 'border-amber-300/30 bg-amber-300/10 text-amber-200',
    bar: 'from-amber-300/60',
  },
  slate: {
    chip: 'border-white/15 bg-white/5 text-slate-300',
    bar: 'from-slate-400/50',
  },
  cyan: {
    chip: 'border-cyan-glow/30 bg-cyan-glow/10 text-cyan-soft',
    bar: 'from-cyan-glow/60',
  },
}

export default function LimitsSection() {
  return (
    <section id="limits" className="section-pad relative">
      <div className="mx-auto max-w-content">
        <SectionHeading
          eyebrow="HONEST · 한계"
          title={
            <>
              아직 <span className="text-amber-300">안 되는 것</span>을 먼저 말합니다
            </>
          }
          description="숨기면 질문 한 번에 무너집니다. 아래는 우리가 재어 보고 알게 된 한계이고, 무엇이 있으면 풀리는지까지 적었습니다."
        />

        <div className="mt-14 grid gap-5 md:grid-cols-2">
          {LIMITS.map((l, i) => {
            const t = TONE[l.tone]
            return (
              <motion.article
                key={l.title}
                initial={{ opacity: 0, y: 26 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={viewport}
                transition={{ duration: 0.5, delay: i * 0.1, ease }}
                className="relative flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-space-800/40 p-7"
              >
                {/* 위쪽 가는 띠 — 카드마다 성격을 색으로 구분한다 */}
                <span
                  aria-hidden
                  className={`absolute inset-x-0 top-0 h-px bg-gradient-to-r to-transparent ${t.bar}`}
                />
                <span
                  className={`self-start rounded-full border px-3 py-1 text-xs font-bold ${t.chip}`}
                >
                  {l.state}
                </span>

                <h3 className="mt-4 break-keep text-lg font-extrabold leading-snug text-white">
                  {l.title}
                </h3>
                <p className="mt-3 break-keep text-sm leading-relaxed text-slate-300">{l.body}</p>

                <p className="mt-4 break-keep border-l-2 border-white/10 pl-4 text-xs leading-relaxed text-slate-400">
                  {l.found}
                </p>

                <div className="mt-5 flex flex-wrap gap-1.5">
                  {l.have.map((h) => (
                    <span
                      key={h}
                      className="whitespace-nowrap rounded-lg bg-white/5 px-2.5 py-1 text-xs font-medium text-slate-300"
                    >
                      {h}
                    </span>
                  ))}
                </div>

                <p className="mt-auto break-keep pt-5 text-xs font-bold leading-relaxed text-cyan-soft/90">
                  → {l.need}
                </p>
              </motion.article>
            )
          })}
        </div>
      </div>
    </section>
  )
}

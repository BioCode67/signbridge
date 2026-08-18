// 수어 무대 — 아바타 + 자막을 한 덩어리로. 받기 화면과 대화 화면이 함께 쓴다.
//
// 대화 화면에서는 화면의 절반만 아바타에 줄 수 있어(나머지는 대화 기록과 답 카드)
// `compact`로 자막을 한 줄로 줄인다. 무대의 문법은 두 화면에서 같아야 한다 —
// 같은 앱 안에서 아바타가 있는 곳마다 다르게 보이면 사용자가 매번 다시 배운다.
import { lazy, Suspense } from 'react'
import { glossLabel } from '../agents/glossLabel'
import { AVATARS } from '../sections/sign/avatars'
import type { SignPlayer } from './useSignPlayer'

const Avatar3D = lazy(() => import('../sections/sign/Avatar3D'))

interface Props {
  player: SignPlayer
  /** 대화 화면용 — 자막을 한 줄로 줄이고 원문은 작게 */
  compact?: boolean
  /** 자막 크기 단계(0 작게 · 1 보통 · 2 크게) */
  fontScale?: 0 | 1 | 2
  /** 아바타가 없을 때 자리 채울 안내 */
  idle?: React.ReactNode
  /** 자막 위에 얹을 요약 배지(받기 화면의 종류·심각도·지역·행동요령) */
  badges?: React.ReactNode
}

export default function SignStage({ player, compact, fontScale = 1, idle, badges }: Props) {
  const { data, frame, playing, busy, nowGloss, time, setPlaying, restart } = player

  return (
    // data-* 는 자동 검증용 계측이다. 화면만 보고는 "재생되는 중"과 "합성 실패라 한 장짜리"를
    // 구분할 수 없어(둘 다 아바타가 서 있다) 회귀를 놓쳤다. 프레임 수를 밖으로 내보낸다.
    <div
      className="relative min-h-0 flex-1 overflow-hidden"
      data-sign-frames={data?.num_frames ?? 0}
      data-sign-playing={playing ? '1' : '0'}
      data-sign-glosses={data?.gloss_sequence.length ?? 0}
      // 번역을 무엇이 했는지 — nn(학습 모델) · dict(통계 사전) · rule.
      // 모델이 안 뜨면 사전이 대신 답하고 **화면은 똑같다.** 오류도 안 난다.
      data-sign-backend={player.backend}
      // 고개 동작이 몇 낱말에 붙었는지 — 배선이 끊기면 0이 된다(역시 화면상 차이 없음).
      data-sign-head={data?.gloss_sequence.filter((g) => g.head).length ?? 0}
    >
      <Suspense
        fallback={
          <div className="grid h-full place-items-center text-slate-500">
            <span className="animate-pulse text-5xl">🤟</span>
          </div>
        }
      >
        {data ? (
          <div
            role="button"
            tabIndex={0}
            aria-label={playing ? '일시정지' : '재생'}
            onClick={() => data.num_frames > 1 && setPlaying((v) => !v)}
            onKeyDown={(e) => e.key === ' ' && data.num_frames > 1 && setPlaying((v) => !v)}
            className="h-full w-full cursor-pointer"
          >
            <Avatar3D data={data} frame={frame} animate modelUrl={AVATARS[0].url} />
            {!playing && data.num_frames > 1 && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center">
                <span className="rounded-full bg-space-900/80 px-8 py-6 text-5xl">▶</span>
              </div>
            )}
          </div>
        ) : (
          <div className="grid h-full place-items-center p-4 text-center">{idle}</div>
        )}
      </Suspense>

      {busy && (
        <div className="absolute inset-x-0 top-3 text-center">
          <span className="rounded-full bg-space-900/90 px-4 py-2 text-base text-cyan-soft">
            수어로 바꾸는 중…
          </span>
        </div>
      )}

      {/* 재생 진행바 — 문장이 얼마나 남았는지 한눈에 */}
      {data && data.num_frames > 1 && (
        <div className="absolute inset-x-0 top-0 h-1.5 bg-white/5">
          <div
            className="h-full bg-cyan-glow/70 transition-[width] duration-100"
            style={{ width: `${(frame / Math.max(1, data.num_frames - 1)) * 100}%` }}
          />
        </div>
      )}

      {data && (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-space-950 via-space-950/85 to-transparent px-3 pb-2 pt-10 text-center">
          {badges}
          {/* 낱말 카드 — 동작으로 표현하지 못한 낱말(지명·기관명)을 큰 글씨로 */}
          {!!data.gloss_missing?.length && (
            <div className="mb-1.5 flex flex-wrap items-center justify-center gap-1.5">
              {data.gloss_missing.map((w, i) => (
                <span
                  key={`${w}-${i}`}
                  className="rounded-xl border-2 border-amber-400/70 bg-amber-400/15 px-2.5 py-1 text-lg font-extrabold text-amber-200"
                >
                  {glossLabel(w)}
                </span>
              ))}
            </div>
          )}
          {/* 문장 진행 — 지금 어느 낱말인지, 앞뒤가 무엇인지.
              **낱말을 다 늘어놓지 않는다.** 재난문자는 18낱말이 예사라 전부 깔면
              작은 글씨 세 줄이 되고, 그만큼 아바타가 밀린다(실측 사진에서 확인).
              읽는 사람에게 필요한 건 "지금 어디쯤"이지 목록 전체가 아니고,
              전체 진행은 위쪽 진행바가 이미 보여 준다. 앞뒤 다섯 낱말만 남긴다. */}
          {!compact && data.gloss_sequence.length > 1 && (() => {
            const seq = data.gloss_sequence
            let cur = seq.findIndex((g) => time >= g.start && time <= g.end)
            if (cur < 0) cur = time > (seq[seq.length - 1]?.end ?? 0) ? seq.length - 1 : 0
            const from = Math.max(0, cur - 5)
            const to = Math.min(seq.length, cur + 6)
            return (
              <div className="mb-1 flex flex-nowrap items-center justify-center gap-1 overflow-hidden">
                {from > 0 && <span className="text-sm text-slate-600">…</span>}
                {seq.slice(from, to).map((g, i) => {
                  const state = time > g.end ? 'done' : time >= g.start ? 'now' : 'todo'
                  return (
                    <span
                      key={`${g.gloss}-${from + i}`}
                      className={`shrink-0 rounded-md px-1.5 py-0.5 text-sm font-bold ${
                        state === 'now' ? 'bg-cyan-glow/30 text-cyan-soft'
                          : state === 'done' ? 'text-slate-300' : 'text-slate-600'
                      }`}
                    >
                      {glossLabel(g.gloss)}
                    </span>
                  )
                })}
                {to < seq.length && <span className="text-sm text-slate-600">…</span>}
              </div>
            )
          })()}
          <p className={`font-extrabold tracking-wide text-cyan-soft text-glow ${
            compact
              ? ['text-xl', 'text-2xl', 'text-4xl'][fontScale]
              : ['text-2xl sm:text-3xl', 'text-3xl sm:text-4xl', 'text-5xl sm:text-6xl'][fontScale]
          }`}>
            {nowGloss || ' '}
          </p>
          <p className={`mx-auto mt-1 max-w-2xl leading-relaxed text-slate-300 ${
            compact
              ? ['text-xs', 'text-sm', 'text-lg'][fontScale]
              : ['text-xs sm:text-sm', 'text-sm sm:text-base', 'text-lg sm:text-xl'][fontScale]
          }`}>
            {data.korean_text}
          </p>
          {compact && data.num_frames > 1 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); restart() }}
              className="mt-1 min-h-[40px] rounded-lg border border-white/15 px-4 py-2 text-sm font-bold text-slate-300"
            >
              🔁 다시 보기
            </button>
          )}
        </div>
      )}
    </div>
  )
}

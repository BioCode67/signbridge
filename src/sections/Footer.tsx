import Button from '../ui/Button'

export default function Footer() {
  return (
    <footer className="relative border-t border-white/10 bg-space-950">
      {/* CTA band */}
      <div className="mx-auto max-w-content px-6 py-20 lg:px-12">
        <div className="glass relative overflow-hidden rounded-3xl px-8 py-14 text-center">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-cyan-glow/10 via-transparent to-transparent" />
          <h3 className="relative text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            들리지 않아도, <span className="text-cyan-soft text-glow">닿습니다.</span>
          </h3>
          <p className="relative mx-auto mt-4 max-w-md text-sm text-slate-400">
            재난의 순간, 들리지 않는 이들에게 가장 빠르게 닿는 AI 수어 통역.
          </p>
          <div className="relative mt-8 flex flex-wrap justify-center gap-4">
            <Button href="#demo" variant="primary">
              수어 데모 보기
            </Button>
            <Button href="#top" variant="ghost">
              처음으로
            </Button>
          </div>
        </div>
      </div>

      {/* Footer meta */}
      <div className="border-t border-white/5">
        <div className="mx-auto flex max-w-content flex-col items-center justify-between gap-6 px-6 py-10 text-sm text-slate-500 md:flex-row lg:px-12">
          <div className="flex items-center gap-2 font-bold text-white">
            <span className="grid h-6 w-6 place-items-center rounded-md bg-cyan-glow/15 text-cyan-soft">
              ◗
            </span>
            Sign<span className="text-cyan-soft">Bridge</span>
          </div>

          <div className="flex flex-col items-center gap-1 text-center text-xs md:items-end md:text-right">
            <span>
              데이터 출처 ·{' '}
              <a
                href="https://www.aihub.or.kr"
                target="_blank"
                rel="noreferrer"
                className="text-slate-400 underline-offset-2 transition-colors hover:text-cyan-soft hover:underline"
              >
                AI Hub
              </a>{' '}
              「재난 안전 정보 전달을 위한 수어영상 데이터」
            </span>
            <span>K-디지털 챌린지 · 넷 챌린지 캠프 시즌13 — AI·네트워크 응용 서비스</span>
            <span className="text-slate-600">
              © 2026 SignBridge. KOREN 기반 실시간 재난방송 AI 수어 통역 시스템.
            </span>
          </div>
        </div>
      </div>
    </footer>
  )
}

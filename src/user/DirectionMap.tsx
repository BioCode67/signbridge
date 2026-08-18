// 방향 지도 — **타일 없이** 그리는 지도.
//
// 재난 때 가장 먼저 끊기는 것이 통신이다. 지도 타일을 받아오는 방식은 정작
// 필요한 순간에 회색 화면이 된다. 그래서 여기서는 내 위치를 한가운데 두고
// 주변 장소를 **상대 위치로** 찍는다 — 데이터는 이미 기기에 있으므로
// 비행기 모드에서도 그대로 그려진다.
//
// 길 모양은 그릴 수 없다(도로 데이터가 없다). 대신 걸어가는 사람에게 실제로
// 필요한 세 가지를 준다: **어느 쪽**, **얼마나**, **무엇이 있는지**.
// 정확한 골목길이 필요하면 아래 '지도 앱으로' 버튼이 기기 지도를 연다(통신 필요).
//
// 나침반이 있으면 화면을 **내가 보는 쪽 기준**으로 돌린다. 북쪽 기준 지도는
// 방향을 스스로 변환해야 읽히지만, 화면이 돌아가면 화살표가 가리키는 쪽으로
// 그냥 걸으면 된다.
import { useEffect, useState } from 'react'
import { KIND_KO, directionKo, roundDistance, walkMinutes, type Ranked } from './nearby'

interface Props {
  target: Ranked
  /** 함께 찍을 주변 장소(목표 포함해도 된다) */
  others?: Ranked[]
  /** 위치 정확도(m) — 원으로 그려 준다. 오차가 크면 방향도 못 믿는다. */
  accuracy?: number
}

/** 기기 나침반 — 지원하지 않으면 null(그때는 북쪽 위 고정). */
function useHeading(): number | null {
  const [heading, setHeading] = useState<number | null>(null)
  useEffect(() => {
    const onOri = (e: DeviceOrientationEvent) => {
      // iOS는 webkitCompassHeading(진북 기준, 시계방향), 그 외는 alpha(반시계).
      const webkit = (e as unknown as { webkitCompassHeading?: number }).webkitCompassHeading
      if (typeof webkit === 'number' && !Number.isNaN(webkit)) setHeading(webkit)
      else if (e.absolute && typeof e.alpha === 'number') setHeading((360 - e.alpha) % 360)
    }
    window.addEventListener('deviceorientationabsolute', onOri as EventListener)
    window.addEventListener('deviceorientation', onOri as EventListener)
    return () => {
      window.removeEventListener('deviceorientationabsolute', onOri as EventListener)
      window.removeEventListener('deviceorientation', onOri as EventListener)
    }
  }, [])
  return heading
}

const SIZE = 260
const C = SIZE / 2

export default function DirectionMap({ target, others = [], accuracy }: Props) {
  const heading = useHeading()
  // 화면 회전 — 나침반이 있으면 내가 보는 쪽이 위로 온다.
  const rot = heading == null ? 0 : -heading
  const dir = directionKo(target.bearing)
  const dist = roundDistance(target.distance)

  // 축척 — 목표가 원의 78% 자리에 오도록. 너무 가까우면 최소 축척을 둔다.
  const span = Math.max(target.distance * 1.28, 120)
  const px = (m: number) => (m / span) * (C - 18)

  const plot = (b: number, d: number) => {
    const a = ((b + rot) - 90) * Math.PI / 180
    return { x: C + Math.cos(a) * px(d), y: C + Math.sin(a) * px(d) }
  }
  const tp = plot(target.bearing, target.distance)

  return (
    <div className="flex flex-col items-center">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="w-full max-w-[280px]"
        role="img"
        aria-label={`${dir.ko}쪽 ${dist.text} ${target.name}`}
      >
        {/* 거리 눈금 — 두 겹이면 "절반쯤 왔다"를 읽을 수 있다 */}
        <circle cx={C} cy={C} r={C - 18} fill="#0b1220" stroke="#1e293b" strokeWidth="2" />
        <circle cx={C} cy={C} r={(C - 18) * 0.5} fill="none" stroke="#1e293b" strokeWidth="1.5" />
        {/* 위치 오차 — 오차가 목표 거리에 육박하면 방향을 믿으면 안 된다 */}
        {accuracy != null && accuracy > 0 && (
          <circle cx={C} cy={C} r={Math.min(px(accuracy), C - 20)}
            fill="#38bdf8" fillOpacity="0.10" stroke="#38bdf8" strokeOpacity="0.35" strokeDasharray="3 3" />
        )}

        {/* 방위 글자 — 화면이 돌면 함께 돈다 */}
        {[['북', 0], ['동', 90], ['남', 180], ['서', 270]].map(([ko, deg]) => {
          const a = ((deg as number) + rot - 90) * Math.PI / 180
          return (
            <text key={ko as string}
              x={C + Math.cos(a) * (C - 7)} y={C + Math.sin(a) * (C - 7) + 5}
              textAnchor="middle" fontSize="13" fontWeight="700"
              fill={ko === '북' ? '#f87171' : '#475569'}>{ko as string}</text>
          )
        })}

        {/* 주변 장소 — 목표 말고도 뭐가 있는지 한눈에 */}
        {others.filter((o) => o !== target && o.distance < span).map((o, i) => {
          const q = plot(o.bearing, o.distance)
          return <circle key={`${o.name}-${i}`} cx={q.x} cy={q.y} r="3.5" fill="#334155" />
        })}

        {/* 나 → 목표 */}
        <line x1={C} y1={C} x2={tp.x} y2={tp.y} stroke="#22d3ee" strokeWidth="3"
          strokeLinecap="round" strokeDasharray="7 5" />
        <circle cx={tp.x} cy={tp.y} r="11" fill="#22d3ee" />
        <text x={tp.x} y={tp.y + 5} textAnchor="middle" fontSize="12">
          {KIND_KO[target.kind].icon}
        </text>

        {/* 나 — 나침반이 없으면 방향을 모르므로 점만, 있으면 보는 쪽 삼각형 */}
        {heading == null
          ? <circle cx={C} cy={C} r="7" fill="#f8fafc" stroke="#0b1220" strokeWidth="2" />
          : <polygon points={`${C},${C - 11} ${C - 7},${C + 7} ${C},${C + 3} ${C + 7},${C + 7}`}
              fill="#f8fafc" stroke="#0b1220" strokeWidth="1.5" />}
      </svg>

      <p className="mt-1 text-sm text-slate-500">
        {heading == null
          ? '위쪽이 북쪽이에요'
          : '휴대폰이 향한 쪽이 위쪽이에요'}
        {' · '}약 {walkMinutes(target.distance)}분 걸어요
      </p>
    </div>
  )
}

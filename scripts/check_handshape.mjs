// 손모양이 **살아 있는가**를 수치로 잰다.
//
//     node --experimental-strip-types --import ./scripts/ts-register.mjs \
//          scripts/check_handshape.mjs
//
// **왜 재나.** 아바타 손이 부드럽게 움직여도, 낱말마다 손모양이 비슷하면 수어가
// 아니다. 화면으로는 "손이 움직인다" 정도로 보여 구별이 무너져도 모른다.
//
// **낱말 이름으로 기준을 세우지 않는다.** 처음에는 `일`·`오`를 숫자로 보고
// "손가락 몇 개가 펴져야 한다"로 쟀는데, 이 낱말들은 숫자가 아니라 `일(하다)`·
// `오(다)`일 수 있다. 이름만 보고 만든 기준은 틀린 것을 통과시킨다.
// 그래서 **가정 없이** 재는 것 셋만 본다:
//
//   ① 웹 조각이 원본의 손모양을 지니는가 (원본이 있을 때만)
//   ② 낱말 안에서 손가락이 따로 움직이는가 (통짜로 움직이면 손모양이 없다)
//   ③ 낱말끼리 손모양이 갈리는가 (다 비슷하면 구별이 사라진 것)
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fingerCurls } from '../src/sections/sign/handShape.ts'

const WEB = 'public/data/glosses'
const ORIG = `${process.env.HOME}/sbdata/glossbank/glosses`
const SAMPLE = 2000

/** 머무는 구간(앞뒤 25%를 뺀 가운데)의 평균 굽힘 벡터. */
function curlVec(H, Z) {
  const a = Math.floor(H.length * 0.25)
  const b = Math.ceil(H.length * 0.75)
  const acc = [0, 0, 0, 0, 0]
  const cnt = [0, 0, 0, 0, 0]
  for (let i = a; i < b; i++) {
    const c = fingerCurls(H[i], Z ? Z[i] : null)
    c.forEach((v, k) => { if (v != null) { acc[k] += v; cnt[k] += 1 } })
  }
  return cnt.some((n) => n === 0) ? null : acc.map((v, k) => v / cnt[k])
}

const names = readdirSync(WEB).filter((f) => f.endsWith('.json')).slice(0, SAMPLE)
const vecs = []
let flat = 0
let noZ = 0
for (const f of names) {
  const d = JSON.parse(readFileSync(`${WEB}/${f}`, 'utf8'))
  const H = d.keypoints?.hand_right ?? d.hand_right
  const Z = d.hand_z?.hand_right ?? null
  if (!H?.length) continue
  if (!Z) noZ += 1
  const v = curlVec(H, Z)
  if (!v) continue
  vecs.push(v)
  // 다섯 손가락 굽힘이 거의 같으면 손이 통짜로 움직이는 것 — 손모양이 없다.
  if (Math.max(...v) - Math.min(...v) < 0.10) flat += 1
}

let bad = 0
console.log(`[손모양] 굽힘 0.12(편 손) ~ 1.00(쥔 손) · 조각 ${vecs.length}개`)

// ① 원본 대비 — 내보내기가 손모양을 잃지 않았는가
if (existsSync(ORIG)) {
  let n = 0
  let sum = 0
  let mx = 0
  let worst = ''
  for (const f of names) {
    if (!existsSync(`${ORIG}/${f}`)) continue
    const w = JSON.parse(readFileSync(`${WEB}/${f}`, 'utf8'))
    const o = JSON.parse(readFileSync(`${ORIG}/${f}`, 'utf8'))
    const HW = w.keypoints?.hand_right ?? w.hand_right
    const HO = o.keypoints3d?.hand_right
    if (!HW?.length || !HO?.length || HW.length !== HO.length) continue
    // 원본 3D는 점당 [x,y,z] — z만 뽑아 같은 자리에 넣는다.
    const Zo = HO.map((fr) => Array.from({ length: 21 }, (_, i) => fr[i * 3 + 2]))
    const vw = curlVec(HW, w.hand_z?.hand_right ?? null)
    const vo = curlVec(HO, Zo)
    if (!vw || !vo) continue
    const dd = Math.hypot(...vw.map((v, i) => v - vo[i]))
    n += 1; sum += dd
    if (dd > mx) { mx = dd; worst = f }
  }
  if (n) {
    // 손가락 하나가 완전히 접힐 때 벌어지는 거리가 0.88이다. 평균 차이가 그 10%를
    // 넘으면 내보내기가 손모양을 갉아먹고 있는 것.
    const ok = sum / n < 0.088
    if (!ok) bad += 1
    console.log(`  ${ok ? '✓' : '✗'} 원본 대비 손모양 유지 — 견준 조각 ${n}개 · 평균 차이 ${(sum / n).toFixed(3)} · 최대 ${mx.toFixed(3)} (${worst})`)
  }
} else {
  console.log('  · 원본(~/sbdata/glossbank)이 없어 내보내기 대조는 건너뜁니다')
}

// ② 손가락이 따로 움직이는가
//
// **기준은 원본에서 왔다.** 처음에는 "5% 미만"으로 두었는데 8.5%가 나와 실패했다.
// 원본(`~/sbdata/glossbank`)을 같은 방법으로 재 보니 **8.4%로 똑같았다** — 다섯
// 손가락이 나란히 펴진 손모양(편 손)이 실제로 그만큼 있는 것이지, 내보내기가
// 손모양을 잃은 것이 아니었다. 임의로 고른 기준은 멀쩡한 것을 고장으로 읽는다.
// 그래서 원본 실측 8.4%에 여유를 두어 12%를 넘을 때만 걸리게 한다.
const flatPct = (flat / vecs.length) * 100
const okFlat = flatPct < 12
if (!okFlat) bad += 1
console.log(`  ${okFlat ? '✓' : '✗'} 손가락이 따로 움직임 — 통짜로 움직이는 조각 ${flat}개(${flatPct.toFixed(1)}% · 원본 실측 8.4% · 12% 미만이어야 함)`)

// ③ 낱말끼리 손모양이 갈리는가 — 손가락별 낱말 사이 표준편차
const sd = (a) => {
  const m = a.reduce((s, x) => s + x, 0) / a.length
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length)
}
const per = [0, 1, 2, 3, 4].map((k) => sd(vecs.map((v) => v[k])))
// 굽힘 폭이 0.88이므로 표준편차 0.10 미만이면 그 손가락은 사실상 고정된 것.
const stuck = per.map((s, k) => [k, s]).filter(([, s]) => s < 0.10)
if (stuck.length) bad += 1
const FN = ['엄지', '검지', '중지', '약지', '새끼']
console.log(`  ${stuck.length ? '✗' : '✓'} 낱말끼리 손모양이 갈림 — ` +
  per.map((s, k) => `${FN[k]} ${s.toFixed(2)}`).join(' · ') +
  (stuck.length ? `  ← ${stuck.map(([k]) => FN[k]).join('·')}가 사실상 고정` : ''))

if (noZ) console.log(`  · 손 깊이가 없는 조각 ${noZ}개 — 그 조각은 2D로만 굽힘을 잽니다`)
console.log(bad ? `\n[손모양] ✗ ${bad}건 — 손모양이 무너졌습니다` : '\n[손모양] ✓ 손모양이 살아 있습니다')
process.exit(bad ? 1 : 0)

// 마우징이 **실제로 입을 움직이는가**를 잰다.
//
//     node --experimental-strip-types --import ./scripts/ts-register.mjs \
//          scripts/check_mouthing.mjs
//
// **왜 재나.** 마우징은 표(`public/data/mouthing.json`)가 안 실리거나 글로스
// 이름이 안 맞으면 조용히 아무것도 안 한다 — 아바타는 손만 움직이고 입은
// 다물고 있는데, 원래 그런 건지 고장인지 화면으로는 구별되지 않는다.
//
// 재는 것 셋:
//   ① 표의 글로스가 동작 사전에 실존하는가 (안 맞으면 영영 안 걸린다)
//   ② 입모양이 낱말마다 다른가 (다 같으면 입이 붙어 있는 것과 같다)
//   ③ 표에 지명이 섞여 있지 않은가 (문장 경계를 안 나누면 지명이 달라붙는다)
import { readFileSync, existsSync } from 'node:fs'
import { mouthTimeline, decompose, sinoNumber, readableGloss } from '../src/sections/sign/mouthing.ts'

const TABLE = 'public/data/mouthing.json'
if (!existsSync(TABLE)) {
  console.log('[마우징] 표가 없습니다 — python3 ml/tools/build_mouthing.py')
  process.exit(1)
}
const table = JSON.parse(readFileSync(TABLE, 'utf8'))
const bank = JSON.parse(readFileSync('public/data/bank.json', 'utf8'))
const bare = new Set(Object.keys(bank).map((k) => k.replace(/[0-9#]+$/, '')))
const keys = Object.keys(table)

let bad = 0
console.log(`[마우징] 표 ${keys.length.toLocaleString()}종`)

// ① 동작 사전에 실존하는가
const hit = keys.filter((g) => bank[g] || bare.has(g.replace(/[0-9#]+$/, '')))
const pct = (hit.length / keys.length) * 100
const okHit = pct >= 60
if (!okHit) bad += 1
console.log(`  ${okHit ? '✓' : '✗'} 동작 사전에 있는 글로스 ${hit.length.toLocaleString()}/${keys.length.toLocaleString()} (${pct.toFixed(1)}%)`)

// ② 입모양이 낱말마다 다른가 — 한글이 아닌 값은 입을 못 움직인다
const noHangul = keys.filter((g) => ![...String(table[g])].some((c) => decompose(c)))
const shapes = new Set()
for (const g of hit.slice(0, 4000)) {
  const t = mouthTimeline(String(table[g]), 8)
  shapes.add(t.map((f) => f.viseme ?? '-').join(''))
}
const okVar = shapes.size >= 50
if (!okVar) bad += 1
console.log(`  ${okVar ? '✓' : '✗'} 입모양이 갈림 — 서로 다른 입모양 ${shapes.size}종 (50종 이상이어야 함)`)
if (noHangul.length) {
  console.log(`  · 한글이 아니어서 입을 못 움직이는 항목 ${noHangul.length}개 (예: ${noHangul.slice(0, 5).map((g) => `${g}→${table[g]}`).join(' ')})`)
}

// ③ 지명 오염 — 재난문자에는 지역명이 늘 붙어 있어 아무 낱말에나 달라붙는다.
//    문장 경계를 안 나누고 파일 전체를 한 덩어리로 보면 실제로 그렇게 됐다
//    (`조심1→얼음`·`장소1→임진`·`춥다1→봉화군`). 행정구역 이름표로 걸러 본다.
const PLACES = 'ml/data/place_names.txt'
if (existsSync(PLACES)) {
  const places = new Set(readFileSync(PLACES, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean))
  const polluted = keys.filter((g) => places.has(String(table[g])) && !places.has(g.replace(/[0-9#]+$/, '')))
  const rate = (polluted.length / keys.length) * 100
  const okP = rate < 8
  if (!okP) bad += 1
  console.log(`  ${okP ? '✓' : '✗'} 지명 오염 ${polluted.length}개(${rate.toFixed(1)}%, 8% 미만)` +
    (polluted.length ? ` — 예: ${polluted.slice(0, 6).map((g) => `${g}→${table[g]}`).join(' ')}` : ''))
} else {
  console.log('  · 행정구역 이름표가 없어 지명 오염 검사는 건너뜁니다 (bash ml/tools/fetch_place_names.sh)')
}

// ④ 수 읽기 — 시각·날짜·숫자 글로스를 국어 규칙대로 옮기는가.
//    100은 `일백`이 아니라 `백`, 6월은 `육월`이 아니라 `유월`, 0시는 `영시`다.
const READ = [
  ['시:9시', '아홉시'], ['시:13시', '십삼시'], ['시:00시53분', '영시오십삼분'],
  ['시:2시5분', '두시오분'], ['시:12시', '열두시'],
  ['날짜:6월23일', '유월이십삼일'], ['날짜:10월1일', '시월일일'],
  ['463', '사백육십삼'], ['자동차2밀리다', '자동차밀리다'],
]
const wrong = READ.filter(([g, want]) => readableGloss(g) !== want)
if (wrong.length) bad += 1
console.log(`  ${wrong.length ? '✗' : '✓'} 수 읽기 ${READ.length - wrong.length}/${READ.length}` +
  (wrong.length ? ` — ${wrong.map(([g, w]) => `${g}→${readableGloss(g)}(${w}이어야)`).join(' ')}` : ''))
const NUM = [[1, '일'], [10, '십'], [11, '십일'], [100, '백'], [101, '백일'], [2026, '이천이십육']]
const nwrong = NUM.filter(([n, w]) => sinoNumber(n) !== w)
if (nwrong.length) bad += 1
console.log(`  ${nwrong.length ? '✗' : '✓'} 한자어 수 ${NUM.length - nwrong.length}/${NUM.length}` +
  (nwrong.length ? ` — ${nwrong.map(([n, w]) => `${n}→${sinoNumber(n)}(${w}이어야)`).join(' ')}` : ''))

console.log(bad ? `\n[마우징] ✗ ${bad}건` : '\n[마우징] ✓ 마우징이 살아 있습니다')
process.exit(bad ? 1 : 0)

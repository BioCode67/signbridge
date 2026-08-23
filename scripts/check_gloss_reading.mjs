// **글로스 이름이 그대로 입·소리로 나가지 않는가**를 훑는다.
//
//     node --experimental-strip-types --import ./scripts/ts-register.mjs \
//          scripts/check_gloss_reading.mjs
//
// **왜 따로 훑나.** `시:9시`·`날짜:6월23일`·`시간:2시간`은 낱말이 아니라 **전용
// 동작의 이름**이다. 이것을 읽지 못하면 두 곳에서 새 나간다:
//
//   ① 마우징 — 아바타 입이 "시간시간"을 발음한다
//   ② 글로스→한국어 — 직원이 스피커로 **"시콜론사시 와요"** 를 듣는다
//
// ②는 **농인이 자기 말이 어떻게 전달됐는지 볼 수 없는 자리다.** 화면에는
// 아무 문제가 없고, 직원은 원래 그런 줄 안다. 눈으로는 영영 못 잡는다.
//
// 실측 2026-08-23: `시간:*` 185종이 전부 `시간시간`·`시간분`으로 나가고 있었다.
// 마우징 수록률은 100%였다 — **읽을 수 있는가는 재고 있지 않았기 때문이다.**
import { readFileSync } from 'node:fs'
import { readableGloss } from '../src/sections/sign/mouthing.ts'
import { glossesToKorean } from '../src/agents/glossToKorean.ts'

const bank = JSON.parse(readFileSync('public/data/bank.json', 'utf8'))
const names = Object.keys(bank)
let fails = 0

// ── ① 이름표가 든 글로스를 전부 읽을 수 있는가 ──────────────────────
const annotated = names.filter((g) => g.includes(':'))
const unreadable = []
for (const g of annotated) {
  const r = readableGloss(g)
  // 못 읽거나(null), 읽은 결과에 기호가 남았거나, **이름표가 낱말처럼 되풀이되면** 실패.
  const tag = g.slice(0, g.indexOf(':'))
  const doubled = r !== null && r.startsWith(tag) && r.slice(tag.length).startsWith(tag)
  if (r === null || /[:#0-9]/.test(r) || doubled) unreadable.push([g, r])
}
console.log(`[읽기] 이름표 글로스 ${annotated.length}종 — 못 읽는 것 ${unreadable.length}종`)
if (unreadable.length) {
  fails++
  for (const [g, r] of unreadable.slice(0, 10)) console.log(`  ✗ ${g} → ${r}`)
  if (unreadable.length > 10) console.log(`  … 그리고 ${unreadable.length - 10}종 더`)
}

// ② 이름표가 **소리로** 나가지 않는가 — 표본으로 확인한다.
const spoken = [
  ['시:9시', '오다'], ['날짜:2월22일', '오다'], ['시간:2시간', '걸리다'],
  ['시간:30분', '기다리다'],
]
for (const gs of spoken) {
  const said = glossesToKorean(gs)
  if (/[:#]/.test(said) || /\d/.test(said)) {
    fails++
    console.log(`  ✗ ${gs.join(' ')} → "${said}"  ← 글로스 이름이 소리로 나갑니다`)
  }
}

// ③ 이형태 번호가 입모양에 남지 않는가(자동차2밀리다처럼 가운데에도 들어간다).
const sample = names.filter((g) => !g.includes(':')).slice(0, 4000)
const leaked = sample.filter((g) => { const r = readableGloss(g); return r !== null && /[0-9#]/.test(r) })
if (leaked.length) {
  fails++
  console.log(`  ✗ 번호가 남은 읽기 ${leaked.length}종 — ${leaked.slice(0, 6).join(', ')}`)
}

console.log()
if (fails) {
  console.log('[읽기] ✗ 글로스 이름이 입이나 소리로 새 나갑니다')
  process.exit(1)
}
console.log(`[읽기] ✓ 이름표 ${annotated.length}종과 표본 ${sample.length}종이 모두 읽힙니다`)

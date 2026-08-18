// 수어 의도 판정 회귀 검사 — 낱말 묶음이 뜻으로 옳게 이어지는지 본다.
//
//     node --experimental-strip-types --import ./scripts/ts-register.mjs \
//          scripts/check_intent.mjs
//
// **왜 따로 재나.** 인식 정확도(top-1 0.7863)와 의도 정확도는 다른 수치다.
// 낱말 하나가 틀려도 의도가 맞을 수 있고("도망"으로 읽혀도 대피소 질문이다),
// 낱말이 다 맞아도 의도를 잘못 붙일 수 있다. 사용자가 실제로 겪는 것은 뒤쪽이다.
//
// **오검출을 특히 본다.** "모르겠어요"라고 답하면 사용자가 다시 하면 그만이지만,
// 엉뚱한 대피소를 알려주면 그쪽으로 걸어간다. 재난 상황에서 그것은 침묵보다 나쁘다.
import { readFileSync } from 'node:fs'
import { detectIntent } from '../src/user/askIntent.ts'

const { cases } = JSON.parse(readFileSync('scripts/intent_cases.json', 'utf8'))

const name = (r) => (r === null ? 'null' : r.intent.kind === 'where'
  ? `where:${r.intent.place}` : r.intent.kind)

let failed = 0
let falsePositive = 0
for (const c of cases) {
  const got = detectIntent(c.words, c.alts ?? [])
  const label = name(got)
  const want = c.expect ?? 'null'
  if (label !== want) {
    failed += 1
    if (want === 'null') falsePositive += 1
    console.log(`  ✗ ${c.이름}`)
    console.log(`     낱말 ${JSON.stringify(c.words)} → ${label} (기대 ${want})`)
  }
}

console.log()
console.log(`의도 판정 ${cases.length - failed}/${cases.length} 통과` +
  (falsePositive ? ` · 오검출 ${falsePositive}건` : ''))
if (failed) process.exit(1)

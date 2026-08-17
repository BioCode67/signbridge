// 번역 회귀 검사 — 실측에서 한 번이라도 틀렸던 문장을 다시 틀리지 않는지 본다.
//
//     node --experimental-strip-types --import ./scripts/ts-register.mjs \
//          scripts/check_translation_cases.mjs
//
// **왜 커버리지만으로는 부족한가.** 낱말 표현률은 "몇 %가 수어로 나갔나"만 잰다.
// 맞게 나갔는지는 재지 않는다. 실제로 복합어 프루닝 버그로 "어디가 아프신지"가
// **"어디 아프다 신다(신발을 신다)"** 로 번역되던 동안에도 표현률은 그대로 83.3%였다.
// 잘못된 수어는 표현되지 않은 것보다 나쁘다 — 농인은 그것을 믿기 때문이다.
//
// 그래서 사례를 박아 둔다. must는 반드시 나와야 하는 표제어, never는 과거에 실제로
// 나왔던 오역이다. 사전·활용형 규칙을 건드리면 이 검사를 돌린다.
import { readFileSync } from 'node:fs'
import { DictSignAgent } from '../src/agents/dictSignAgent.ts'

const align = JSON.parse(readFileSync('public/data/align.json', 'utf8'))
const order = JSON.parse(readFileSync('public/data/order.json', 'utf8'))
// 번역기는 사전과 어순표를 각각 받아온다 — 스텁도 **URL을 보고** 갈라 주어야 한다.
// (한동안 모든 요청에 사전을 돌려주는 바람에 어순 검사가 조용히 무력화돼 있었다.)
globalThis.fetch = async (url) => ({
  ok: true,
  json: async () => (String(url).includes('order.json') ? order : align),
})

const { cases, koreanCases = [] } = JSON.parse(
  readFileSync('scripts/translation_cases.json', 'utf8'),
)
const agent = new DictSignAgent('align.json')
const lemma = (g) => g.replace(/[0-9#:]+$/, '')

let failed = 0
for (const c of cases) {
  const { gloss } = await agent.convert(c.text)
  const lemmas = gloss.map(lemma)
  const missing = (c.must ?? []).filter((w) => !lemmas.includes(w))
  const wrong = (c.never ?? []).filter((w) => lemmas.includes(w))
  // 어순 — 수어는 [언제·어디] → [무슨 일] → [당부] 순서다. 낱말이 다 나와도
  // 순서가 한국어 그대로면 농인에게는 어색하다.
  const wantOrder = c.order ?? []
  const spots = wantOrder.map((w) => lemmas.indexOf(w))
  const orderBroken = spots.some((v, i) => v < 0 || (i > 0 && v < spots[i - 1]))
  if (missing.length === 0 && wrong.length === 0 && !orderBroken) continue
  failed++
  console.log(`  ✗ ${c.text}`)
  console.log(`     번역: ${lemmas.join(' ') || '(없음)'}`)
  if (missing.length) console.log(`     빠짐: ${missing.join(', ')}`)
  if (wrong.length) console.log(`     오역: ${wrong.join(', ')}  ← 과거에 났던 오역이 되살아났다`)
  if (orderBroken) console.log(`     어순: ${wantOrder.join(' → ')} 순서여야 한다`)
}

// 반대 방향 — 수어 낱말열을 직원이 듣는 한국어 문장으로. 어미 하나가 어긋나면
// "머리 어제 아프다"처럼 들려 되묻게 된다.
const { glossesToKorean } = await import('../src/agents/glossToKorean.ts')
for (const c of koreanCases) {
  const got = glossesToKorean(c.glosses)
  if (got === c.text) continue
  failed++
  console.log(`  ✗ ${c.glosses.join(' ')}`)
  console.log(`     기대: ${c.text}`)
  console.log(`     실제: ${got}`)
}

console.log(`\n[cases] ${cases.length + koreanCases.length}개 중 ${cases.length + koreanCases.length - failed}개 통과`)
if (failed) {
  console.log('[cases] ✗ 번역 회귀가 있습니다 — 사전 규칙을 되짚어 보세요')
  process.exit(1)
}
console.log('[cases] ✓ 회귀 없음')

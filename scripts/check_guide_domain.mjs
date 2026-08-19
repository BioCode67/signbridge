// 행동요령이 **사전으로** 번역되는지 지킨다.
//
//     node --experimental-strip-types --import ./scripts/ts-register.mjs \
//          scripts/check_guide_domain.mjs
//
// **왜 이것을 검사로 박나.** 학습 모델은 재난문자(공지 말투)로 배웠다. 행동요령은
// 명령 말투라 배운 적이 없는데, 코드에 "같은 말투니 모델이 배운 자리"라고 적혀
// 있어서 한동안 모델로 번역됐다. 실측 결과가 이렇다.
//
//   엘리베이터를 타지 말고 계단으로 대피하세요
//     사전: 엘리베이터1 타다0 계단0 대피0 하지마1
//     모델: 주말1 기간1 필요1 때1 사람2#
//
// 목숨이 걸린 안내가 헛소리로 나가는데 **화면은 멀쩡하다** — 아바타는 무언가를
// 하고 있고 자막에는 한국어 원문이 그대로 떠 있다. 눈으로는 절대 못 잡는다.
//
// 여기서는 도메인 배선(UserApp이 'everyday'로 넘기는가)과, 사전이 실제로 그
// 문장들을 낱말로 덮는가를 함께 본다.
import { readFileSync } from 'node:fs'

const src = readFileSync('src/user/UserApp.tsx', 'utf8')
const R = 'public/data/'
const align = JSON.parse(readFileSync(R + 'align.json', 'utf8'))
const order = JSON.parse(readFileSync(R + 'order.json', 'utf8'))
const timegloss = JSON.parse(readFileSync(R + 'timegloss.json', 'utf8'))
const bank = JSON.parse(readFileSync(R + 'bank.json', 'utf8'))
globalThis.fetch = async (u) => ({
  ok: true,
  json: async () => {
    const s = String(u)
    if (s.includes('order.json')) return order
    if (s.includes('timegloss.json')) return timegloss
    return align
  },
})

// ── 1) 배선 — onAnswer가 'disaster'로 넘기면 안 된다.
const onAnswer = src.slice(src.indexOf('const onAnswer'), src.indexOf('const item = feed.length'))
const wired = /player\.play\(text, gloss, 'everyday'\)/.test(onAnswer)
console.log(wired
  ? '  ✓ 행동요령 재생이 사전 경로로 배선돼 있습니다'
  : "  ✗ onAnswer가 'everyday'로 넘기지 않습니다 — 행동요령이 학습 모델로 갑니다")

// ── 2) 사전이 그 문장들을 실제로 덮는가.
const { SAFETY_GUIDES } = await import('../src/user/safetyGuides.ts')
const { DictSignAgent } = await import('../src/agents/dictSignAgent.ts')
const agent = new DictSignAgent('align.json')

let sentences = 0
let empty = 0
let unplayable = []
for (const guide of SAFETY_GUIDES) {
  for (const step of guide.steps) {
    sentences += 1
    const { gloss } = await agent.convert(step)
    if (!gloss.length) {
      empty += 1
      console.log(`  ✗ 글로스가 하나도 안 나옵니다: ${step}`)
      continue
    }
    // 사전에 있어도 **동작 클립이 없으면 조용히 건너뛴다** — 아바타가 가만히 선다.
    for (const g of gloss) if (!bank[g]) unplayable.push(`${step} → ${g}`)
  }
}

console.log(`  · 행동요령 ${sentences}문장 · 글로스가 빈 문장 ${empty}`)
if (unplayable.length) {
  console.log(`  ✗ 동작 사전에 없는 글로스 ${unplayable.length}건 — 앞 5건`)
  for (const u of unplayable.slice(0, 5)) console.log(`      ${u}`)
} else {
  console.log('  ✓ 모든 글로스가 동작 사전에 있습니다')
}

const failed = !wired || empty > 0 || unplayable.length > 0
console.log(failed ? '\n[행동요령] ✗ 문제가 있습니다' : '\n[행동요령] ✓ 통과')
process.exit(failed ? 1 : 0)

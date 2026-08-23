// **부정이 살아서 나가는가**를 말투별로 훑는다.
//
//     node --experimental-strip-types --import ./scripts/ts-register.mjs \
//          scripts/check_negation.mjs
//
// **왜 따로 훑나.** 부정이 빠지면 **뜻이 그대로 뒤집힌다** — 표현률로는 절대
// 안 잡힌다(낱말은 다 나갔기 때문이다). 그런데 지금까지 세 번을 **각각 다른
// 계기로 우연히** 찾았다:
//
//     2026-08-18  `안`·`못`이 "너무 짧다"는 규칙에 걸려 통째로 버려졌다
//     2026-08-20  `-지 않도록`·`않기`가 **제외어**라 조용히 사라졌다
//     2026-08-20  `없습니다`도 제외어였다 — `이용할 수 없습니다` → `이용`
//
// 우연에 기대지 않으려고 **한국어 부정 말투를 늘어놓고 한 번에 잰다.**
// 새 말투가 떠오르면 여기 한 줄 더하면 된다.
import { readFileSync } from 'node:fs'

const align = JSON.parse(readFileSync('public/data/align.json', 'utf8'))
const order = JSON.parse(readFileSync('public/data/order.json', 'utf8'))
const timegloss = JSON.parse(readFileSync('public/data/timegloss.json', 'utf8'))
globalThis.fetch = async (u) => ({
  ok: true,
  json: async () => {
    const s = String(u)
    if (s.includes('order.json')) return order
    if (s.includes('timegloss.json')) return timegloss
    return align
  },
})
const { DictSignAgent } = await import('../src/agents/dictSignAgent.ts')
const agent = new DictSignAgent('align.json')

/** 수어에서 부정을 나르는 글로스들. 하나라도 나오면 부정이 살아 있는 것. */
const NEG = ['아니다', '못하다', '하지마', '없다', '금지', '안되다', '불가능']
const lemma = (g) => g.replace(/[0-9#:@]+$/, '')

// 말투별 대표 문장. **하나씩 다른 어미를 노린다.**
const CASES = [
  ['안 + 동사', '약을 안 먹었어요'],
  ['못 + 동사', '못 갑니다'],
  ['-지 마세요', '들어가지 마세요'],
  ['-지 마십시오', '절대 만지지 마십시오'],
  ['-지 않도록', '다치지 않도록 조심하세요'],
  ['-지 않게', '잊지 않게 적어 두세요'],
  ['-지 않기', '다치지 않기 바랍니다'],
  ['-지 않습니다', '운행하지 않습니다'],
  ['-지 않아요', '아직 열지 않아요'],
  ['-ㄹ 수 없습니다', '지금은 이용할 수 없습니다'],
  ['없습니다', '남은 자리가 없습니다'],
  ['없어요', '물이 없어요'],
  ['-면 안 됩니다', '만지면 안 됩니다'],
  ['금지', '출입을 금지합니다'],
  ['-지 말고', '엘리베이터를 타지 말고 계단으로 가세요'],
  ['불가', '오늘은 예약이 불가합니다'],
]

let bad = 0
console.log('[부정] 부정이 살아서 나가는가 — 빠지면 **뜻이 그대로 뒤집힌다**')
for (const [name, text] of CASES) {
  const { gloss } = await agent.convert(text)
  const has = gloss.some((g) => NEG.includes(lemma(g)))
  if (!has) bad += 1
  console.log(`  ${has ? '✓' : '✗'} ${name.padEnd(14)} ${text}`)
  if (!has) console.log(`      → ${gloss.join(' ')}  ← 부정이 없다`)
}

// **부정이 자기 동사 옆에 있는가**도 본다. 어순을 바꿀 때 부정이 엉뚱한 동사
// 옆으로 밀리면, 이번엔 **다른 것을 금지하는 말**이 된다.
//   넘어지지 않도록 손잡이를 잡으세요 → 손잡이 잡다 **하지마** 넘어지다
//                                        ↑ "손잡이를 잡지 마라"
const NEAR = [
  ['넘어지지 않도록 손잡이를 잡으세요', '넘어지다'],
  ['물이 넘치지 않도록 하세요', '넘치다'],
  ['미끄러지지 않도록 천천히 걸으세요', '미끄럽다'],
]
for (const [text, verb] of NEAR) {
  const { gloss } = await agent.convert(text)
  const gi = gloss.findIndex((g) => lemma(g) === verb)
  const ni = gloss.findIndex((g) => NEG.includes(lemma(g)))
  const ok = gi >= 0 && ni >= 0 && Math.abs(gi - ni) === 1
  if (!ok && gi >= 0) bad += 1
  if (gi < 0) {
    console.log(`  · ${text} — '${verb}'가 사전에 없어 건너뜁니다`)
    continue
  }
  console.log(`  ${ok ? '✓' : '✗'} 부정이 '${verb}' 옆에 — ${gloss.join(' ')}`)
}

// **부정만 남고 동사가 사라지지 않는가.**
//
// 이것이 세 번째 실패 모양이다. 부정은 살아 있고(위 검사는 통과한다) **부정할
// 대상이 없다** — 뜻이 통째로 없어진다:
//
//     문이 안 열려요 → `문0 **아니다0**`     ← "문이 아니다"로 읽힌다
//     불이 안 켜져요 → `불0 **아니다0**`
//
// 피동형(`열리다`·`켜지다`)이 사전에 없어서였다(2026-08-23 실측). 부정이 빠지는
// 것만큼 나쁜데 위 두 검사로는 안 잡힌다.
const ALONE = [
  ['문이 안 열려요', '열다'],
  ['불이 안 켜져요', '켜다'],
  ['물이 안 나와요', '나오다'],
  ['문이 안 닫혀요', '닫다'],
  ['약을 안 먹었어요', '먹다'],
  ['못 갑니다', '가다'],
  ['인터넷이 안 돼요', '되다'],
]
for (const [text, verb] of ALONE) {
  const { gloss } = await agent.convert(text)
  const lemmas = gloss.map(lemma)
  const hasVerb = lemmas.includes(verb)
  const negAt = lemmas.findIndex((g) => NEG.includes(g))
  const verbAt = lemmas.indexOf(verb)
  // 부정은 있는데 동사가 없으면 실패. 있으면 **바로 옆에** 있어야 한다.
  const ok = hasVerb && (negAt < 0 || Math.abs(verbAt - negAt) === 1)
  if (!ok) bad += 1
  console.log(`  ${ok ? '✓' : '✗'} 부정할 대상이 남아 있는가 — ${text} → ${gloss.join(' ') || '(없음)'}`)
  if (!hasVerb) console.log(`      '${verb}'가 사라졌다 — 부정만 남으면 뜻이 통째로 없어진다`)
}

console.log(bad ? `\n[부정] ✗ ${bad}건 — 뜻이 뒤집혀 나갑니다` : '\n[부정] ✓ 모든 말투에서 부정이 살아 있습니다')
process.exit(bad ? 1 : 0)

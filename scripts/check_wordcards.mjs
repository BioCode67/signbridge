// **낱말 카드가 실제로 뜨는가** — 동작으로 표현 못 한 낱말을 글자로라도 보여주는 장치.
//
//     node --experimental-strip-types --import ./scripts/ts-register.mjs \
//          scripts/check_wordcards.mjs
//
// **왜 필요한가.** 수어 클립이 없는 낱말이 있다(처방전·부작용·등본·창구…).
// 그때 앱은 그 낱말을 **큰 글씨 카드**로 띄워 정보 손실만은 막는다.
// 이 장치가 끊기면 아바타는 나머지를 멀쩡히 재생하고 자막도 그대로라서
// **화면만 봐서는 알 수 없다** — 농인은 그 낱말이 있었다는 사실조차 모른다.
//
// 여기서는 번역기까지만 본다(빠진 낱말이 실제로 잡히는가). 화면에 뜨는지는
// e2e의 `data-sign-cards` 계측점이 확인한다.
import { readFileSync } from 'node:fs'
import { DictSignAgent } from '../src/agents/dictSignAgent.ts'

const R = (p) => JSON.parse(readFileSync('public/data/' + p, 'utf8'))
const align = R('align.json'), order = R('order.json'), timegloss = R('timegloss.json')
globalThis.fetch = async (url) => ({
  ok: true,
  json: async () => {
    const u = String(url)
    if (u.includes('order.json')) return order
    if (u.includes('timegloss.json')) return timegloss
    return align
  },
})
const agent = new DictSignAgent('align.json')

// 수어 클립이 없다고 확인된 창구 낱말 — 이것들은 **카드로 나와야** 한다.
// 2026-08-20: `등본`·`창구`는 뜻이 넓어지는 대체(서류·장소)를 붙여 이제 수어로 나간다.
// 카드는 **대체할 것이 없는** 낱말에만 필요하다 — 처방전을 `약`으로 바꾸면
// 다른 것을 가리키게 되므로 그런 것은 대체하지 않고 카드로 둔다.
const CASES = [
  ['처방전 보여 주세요', '처방전'],
  ['부작용이 있으면 병원에 가세요', '부작용'],
  ['영수증을 드릴까요', '영수증'],
  ['보험 적용해 드릴게요', '보험'],
]

let bad = 0
console.log('[낱말 카드] 수어로 못 내는 낱말이 빠진 것으로 잡히는가')
for (const [text, word] of CASES) {
  const { unmatched } = await agent.convert(text)
  const got = (unmatched ?? []).some((u) => u.includes(word) || word.includes(u))
  console.log(`  ${got ? '✓' : '✗'} ${word.padEnd(6)} ← "${text}"` +
    (got ? '' : `  (빠짐 목록: ${(unmatched ?? []).join(' ') || '없음'})`))
  if (!got) bad++
}

console.log(bad
  ? `\n[낱말 카드] ✗ ${bad}건 — 빠진 낱말이 잡히지 않으면 화면에 카드가 안 뜬다`
  : `\n[낱말 카드] ✓ ${CASES.length}건 모두 카드로 나갈 수 있습니다`)
process.exit(bad ? 1 : 0)

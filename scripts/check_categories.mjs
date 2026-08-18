// 재난문자 **갈래 이름**이 피드를 전부 덮는지 본다.
//
//     node --experimental-strip-types --import ./scripts/ts-register.mjs \
//          scripts/check_categories.mjs
//
// **왜 따로 재나.** 표에 없는 코드는 `code.slice(0, 10)`로 그냥 영문이 나간다 —
// 오류도 안 나고 빈칸도 아니어서 **화면은 멀쩡해 보인다.** 실측 사진에서 태블릿
// 머리말에 `YELLOWDUST`가 떠 있었고, 세어 보니 피드 41종 중 17종이 그랬다.
// 농인 이용자에게 영문 코드는 아무 뜻도 없다. 무슨 재난인지가 첫 정보인데 그것이
// 비어 있는 셈이다.
//
// 안내(행동요령)도 함께 본다. 갈래에 안내가 없으면 "무엇을 해야 하나"가 빈다.
import { readFileSync } from 'node:fs'

const feed = JSON.parse(readFileSync('public/data/feed.json', 'utf8'))
const { categoryKo } = await import('../src/sections/sign/categories.ts')
const { guideFor } = await import('../src/user/safetyGuides.ts')

const codes = [...new Set(feed.map((x) => x.category).filter(Boolean))].sort()
const missing = codes.filter((c) => categoryKo(c) === c.slice(0, 10))
const noGuide = codes.filter((c) => !guideFor(c))

console.log(`[갈래] 피드에 ${feed.length}건 · 갈래 ${codes.length}종`)
if (missing.length) {
  console.log(`  ✗ 한국어 이름이 없어 영문이 그대로 나가는 갈래 ${missing.length}종:`)
  for (const c of missing) console.log(`      ${c}`)
} else {
  console.log(`  ✓ ${codes.length}종 모두 한국어 이름이 있습니다`)
}

// 안내는 없을 수 있다 — 없는 것이 잘못은 아니지만 **몇 종이 비었는지는 알고 있어야** 한다.
console.log(`  · 행동요령이 붙는 갈래 ${codes.length - noGuide.length}/${codes.length}종`)
if (noGuide.length) console.log(`    안내 없음: ${noGuide.join(' ')}`)

process.exit(missing.length ? 1 : 0)

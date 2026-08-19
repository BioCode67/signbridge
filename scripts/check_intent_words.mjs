// 의도 판정에 쓰는 낱말이 **인식 모델의 클래스에 실제로 있는지** 본다.
//
//     node --experimental-strip-types --import ./scripts/ts-register.mjs \
//          scripts/check_intent_words.mjs
//
// **왜 따로 재나.** `askIntent.ts`는 인식된 낱말을 후보 목록과 맞춰 뜻을 고른다.
// 목록에 모델이 낼 수 없는 낱말이 섞여 있으면 그 항목은 **영영 맞지 않는다** —
// 오류도 안 나고 경고도 없다. 그냥 그 뜻으로는 절대 안 알아듣는 것뿐이다.
// 화면만 봐서는 "인식이 잘 안 되네" 정도로 보인다.
//
// 모델을 갈아 끼우면 클래스 목록이 통째로 바뀐다(iso-v1 8,147 → iso-v2 13,576).
// 그때 조용히 무력화되는 낱말이 생긴다. 그래서 모델 교체 뒤에는 반드시 이것을 돈다.
import { readFileSync } from 'node:fs'

const meta = JSON.parse(readFileSync('public/models/ksl-iso/meta.json', 'utf8'))
const mod = await import('../src/user/askIntent.ts')

// 클래스 이름은 `병원1`·`어디2`처럼 뒤에 이형 번호가 붙는다. 앱도 glossLabel로
// 번호를 떼고 비교하므로 여기서도 같은 방식으로 맞춘다.
const bare = new Set(meta.labels.map((l) => String(l).replace(/[0-9#]+$/, '')))

const groups = mod.INTENT_WORDS ?? null
if (!groups) {
  console.log('✗ askIntent.ts가 INTENT_WORDS를 내보내지 않습니다')
  process.exit(1)
}

let missing = 0
let total = 0
console.log(`[의도] 인식 클래스 ${meta.labels.length}종 (에폭 ${meta.trained_epoch} · top-1 ${meta.val_top1})`)
for (const [name, words] of Object.entries(groups)) {
  const gone = words.filter((w) => !bare.has(w))
  total += words.length
  missing += gone.length
  const mark = gone.length ? '✗' : '✓'
  console.log(`  ${mark} ${name} ${words.length - gone.length}/${words.length}` +
    (gone.length ? ` — 모델이 낼 수 없는 낱말: ${gone.join(' ')}` : ''))
}

console.log(missing
  ? `\n[의도] ${total}개 중 ${missing}개가 인식 클래스에 없습니다 — 그 뜻으로는 영영 안 알아듣습니다`
  : `\n[의도] ✓ ${total}개 모두 인식 클래스에 있습니다`)
process.exit(missing ? 1 : 0)

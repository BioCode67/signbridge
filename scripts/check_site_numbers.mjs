// **화면에 적힌 숫자를 원본과 대조한다.**
//
//     node --experimental-strip-types --import ./scripts/ts-register.mjs \
//          scripts/check_site_numbers.mjs
//
// 왜 따로 재나. 발표 화면의 숫자는 **아무도 다시 안 본다.** 사전을 다시 만들거나
// 모델을 갈아 끼우면 원본은 바뀌는데 화면 글자는 그대로 남는다. 오류도 안 나고
// 화면도 멀쩡하다 — 그냥 **틀린 숫자를 발표하게 된다.**
//
// 실제로 이렇게 낡아 있었다: 동작 어휘 11,448(→12,833) · 인식 클래스 8,147(→13,576)
// · top-1 78.7%(→78.2%) · 자동 검사 259개(→266) · 번역 낱말 230,160(→230,299).
//
// 여기서는 **기계가 읽을 수 있는 원본이 있는 숫자만** 본다. 사람이 재야 하는
// 숫자(BLEU·표현률·당사자 평가)는 대상이 아니다 — 그건 DECISIONS.md가 기록한다.
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(p, 'utf8')
const json = (p) => JSON.parse(read(p))

const meta = json('public/models/ksl-iso/meta.json')
const bank = json('public/data/bank.json')
const align = json('public/data/align.json')
const cases = json('scripts/translation_cases.json')
const intents = json('scripts/intent_cases.json')

const nCases =
  (cases.cases?.length ?? 0) + (cases.koreanCases?.length ?? 0)
const nIntent = Array.isArray(intents) ? intents.length : (intents.cases?.length ?? 0)

// 화면 글자에서 숫자를 뽑을 파일들
const src = [
  'src/sections/ResultsSection.tsx',
  'src/sections/LimitsSection.tsx',
  'src/sections/RecognitionDemo.tsx',
  'src/sections/SignAvatarDemo.tsx',
  'src/user/RecognizedWords.tsx',
].map((f) => [f, read(f)])

const comma = (n) => n.toLocaleString('en-US')

/** 원본에서 나온 값 → 화면에 이 글자가 있어야 한다 */
const TRUTH = [
  { what: '인식 클래스', want: comma(meta.labels.length), src: 'meta.json labels' },
  { what: '동작 어휘', want: comma(Object.keys(bank).length), src: 'bank.json' },
  { what: '번역 낱말', want: comma(Object.keys(align).length), src: 'align.json' },
  { what: '오역 회귀 사례', want: String(nCases), src: 'translation_cases.json' },
  { what: '의도 사례', want: String(nIntent), src: 'intent_cases.json' },
  {
    what: 'top-1',
    want: (meta.val_top1 * 100).toFixed(1) + '%',
    src: 'meta.json val_top1',
  },
]

/** 화면에 **있으면 안 되는** 옛 숫자 — 갈아 끼운 뒤 남은 흔적 */
const STALE = [
  ['11,448', '옛 동작 어휘'],
  ['8,147', '옛 인식 클래스(CTC 설명은 예외)'],
  ['78.7%', '옛 top-1'],
  ['259개', '옛 자동 검사 수'],
]

let bad = 0
console.log('[화면 숫자] 원본과 대조합니다')
for (const t of TRUTH) {
  // 숫자 앞뒤에 다른 숫자가 붙으면 안 된다 — `27`이 BLEU `27.1`에 걸리던 문제.
  const re = new RegExp(`(?<![\\d.,])${t.want.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\d,]|\\.\\d)`)
  const hit = src.filter(([, s]) => re.test(s)).map(([f]) => f.split('/').pop())
  if (hit.length) {
    console.log(`  ✓ ${t.what} ${t.want} — ${hit.join(', ')}`)
  } else {
    bad++
    console.log(`  ✗ ${t.what}: 원본은 ${t.want}인데(${t.src}) 화면 어디에도 없습니다`)
  }
}

for (const [n, why] of STALE) {
  for (const [f, s] of src) {
    // CTC 카드는 "8,147종이라 배포본 13,576종과 다르다"를 **설명하려고** 쓴다.
    if (n === '8,147' && s.includes('8,147종이라')) continue
    if (s.includes(n)) {
      bad++
      console.log(`  ✗ ${f.split('/').pop()}에 옛 숫자 ${n}이 남아 있습니다 (${why})`)
    }
  }
}

console.log(
  bad
    ? `\n[화면 숫자] ✗ ${bad}건 — 원본이 바뀌었는데 화면 글자가 안 따라갔습니다`
    : `\n[화면 숫자] ✓ ${TRUTH.length}개 모두 원본과 같습니다`,
)
process.exit(bad ? 1 : 0)

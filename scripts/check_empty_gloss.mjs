// **글로스가 통째로 비는 문장이 없는가.**
//
//     node --experimental-strip-types --import ./scripts/ts-register.mjs \
//          scripts/check_empty_gloss.mjs
//
// **왜 따로 재나.** 글로스가 비면 **아바타가 아무것도 안 한다.** 낱말 카드는 뜨므로
// 화면이 완전히 비지는 않지만, 농인이 보는 것은 한국어 낱말 하나뿐이다 —
// 수어로는 아무 말도 안 한 것이다.
//
// 실측(2026-08-20): 앱이 쓰는 문장 476개 중 **20개가 이랬고 전부 `X 주세요` 꼴**이었다.
// `처방전`은 수어가 없고 `주세요`는 제외어라, 둘 다 빠지면 남는 게 없었다.
// 창구에서 이건 "요청"이라는 뜻 자체가 사라진 것이다.
//
// 표현률로는 절대 안 잡힌다 — 표현률은 낱말 단위이고, 이건 문장 단위 실패다.
import { readFileSync } from 'node:fs'
import { DictSignAgent } from '../src/agents/dictSignAgent.ts'

const R = 'public/data/'
const align = JSON.parse(readFileSync(R + 'align.json', 'utf8'))
const order = JSON.parse(readFileSync(R + 'order.json', 'utf8'))
const timegloss = JSON.parse(readFileSync(R + 'timegloss.json', 'utf8'))
globalThis.fetch = async (u) => ({
  ok: true,
  json: async () => {
    const s = String(u)
    if (s.includes('order.json')) return order
    if (s.includes('timegloss.json')) return timegloss
    return align
  },
})
const agent = new DictSignAgent('align.json')

// 앱이 실제로 쓰는 문장 + 측정용 묶음
const sents = []
for (const f of ['창구대화', '창구대화_홀드아웃', '일상회화', '일상회화_홀드아웃',
                 '행동요령', '길찾기']) {
  const d = JSON.parse(readFileSync(`scripts/audit_sets/${f}.json`, 'utf8'))
  sents.push(...(Array.isArray(d) ? d : d.sentences ?? []).map((x) => (typeof x === 'string' ? x : x.text)))
}
// 창구 상용구와 행동요령은 소스에서 직접 뽑는다 — 측정 묶음이 좁다.
for (const f of ['src/user/places.ts', 'src/user/safetyGuides.ts']) {
  const src = readFileSync(f, 'utf8')
  for (const m of src.matchAll(/['"`]([^'"`\n]{6,})['"`]/g)) {
    const t = m[1]
    if ((t.match(/[가-힣]/g) ?? []).length >= 4) sents.push(t)
  }
}

const empty = []
for (const t of [...new Set(sents)]) {
  if (!t) continue
  const { gloss } = await agent.convert(t)
  if (!gloss.length) empty.push(t)
}

console.log(`[빈 글로스] 문장 ${new Set(sents).size}개를 봤습니다`)
for (const t of empty.slice(0, 10)) console.log(`  ✗ "${t}"`)
if (empty.length > 10) console.log(`  … 그 밖에 ${empty.length - 10}개`)
console.log(empty.length
  ? `\n[빈 글로스] ✗ ${empty.length}개 — 아바타가 아무것도 하지 않습니다`
  : `\n[빈 글로스] ✓ 모든 문장이 수어로 나갑니다`)
process.exit(empty.length ? 1 : 0)

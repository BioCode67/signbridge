// 번역이 낸 글로스가 **동작 사전에 실제로 있는지** 본다.
//
//     node --experimental-strip-types --import ./scripts/ts-register.mjs \
//          scripts/check_silent_skip.mjs
//
// **이 프로젝트의 대표적 실패 모양이다.** 사전에 없는 글로스는 재생 때 조용히
// 건너뛴다 — 오류도 안 나고, 아바타는 나머지를 이어서 하고, 자막에는 한국어
// 원문이 그대로 떠 있다. 화면만 보면 정상이다. 실측에서 사전 재생성 뒤 상용구
// 30개 중 17개가, '월'이 31회, '점'이 8회 이렇게 증발한 적이 있다.
//
// `check_app_glosses.py`는 앱이 코드에 박아 둔 상용구를 본다. 여기서는 **번역기가
// 문장에서 만들어 내는 글로스**를 본다 — 사전·어순표를 고치면 여기서 새는지가
// 바뀐다. 둘 다 필요하다.
//
// 재난문자(피드)와 측정용 문장 네 갈래를 모두 통과시킨다.
import { readFileSync } from 'node:fs'

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

const { DictSignAgent } = await import('../src/agents/dictSignAgent.ts')
const agent = new DictSignAgent('align.json')

const rows = []
for (const x of JSON.parse(readFileSync('public/data/feed.json', 'utf8')).slice(0, 120)) {
  rows.push({ set: '재난문자', text: x.text })
}
for (const name of ['일상회화', '창구대화', '길찾기', '행동요령', '일상회화_홀드아웃',
  '창구대화_홀드아웃']) {
  let raw
  try {
    raw = JSON.parse(readFileSync(`scripts/audit_sets/${name}.json`, 'utf8'))
  } catch {
    continue
  }
  for (const r of raw) rows.push({ set: name, text: typeof r === 'string' ? r : r.text })
}

const stat = new Map()
const examples = []
for (const r of rows) {
  const { gloss } = await agent.convert(r.text)
  const s = stat.get(r.set) ?? { n: 0, g: 0, miss: 0 }
  s.n += 1
  s.g += gloss.length
  for (const g of gloss) {
    if (!bank[g]) {
      s.miss += 1
      if (examples.length < 8) examples.push(`${r.set} · ${r.text.slice(0, 30)} → ${g}`)
    }
  }
  stat.set(r.set, s)
}

let total = 0
let missing = 0
console.log('[조용한 누락] 번역이 낸 글로스가 동작 사전에 있는가')
for (const [name, s] of stat) {
  total += s.g
  missing += s.miss
  const mark = s.miss ? '✗' : '✓'
  console.log(`  ${mark} ${name} — 문장 ${s.n} · 글로스 ${s.g} · 건너뛸 것 ${s.miss}`)
}
for (const e of examples) console.log(`      ${e}`)

console.log(missing
  ? `\n[조용한 누락] ✗ 글로스 ${total}개 중 ${missing}개가 재생되지 않습니다`
  : `\n[조용한 누락] ✓ 글로스 ${total}개 전부 재생됩니다`)
process.exit(missing ? 1 : 0)

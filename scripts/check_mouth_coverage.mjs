// 마우징이 **실제 문장에서** 몇 낱말에 붙는지 잰다.
//
// 표에 1,635종이 있어도 실제로 쓰이는 글로스에 안 붙으면 소용이 없다.
// 화면에서 세어 보니 한 문장 20낱말 중 2개뿐이었다 — 그래서 따로 잰다.
import { readFileSync } from 'node:fs'

const align = JSON.parse(readFileSync('public/data/align.json', 'utf8'))
const order = JSON.parse(readFileSync('public/data/order.json', 'utf8'))
const timegloss = JSON.parse(readFileSync('public/data/timegloss.json', 'utf8'))
const mouth = JSON.parse(readFileSync('public/data/mouthing.json', 'utf8'))
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
for (const name of ['일상회화', '창구대화', '길찾기', '행동요령']) {
  try {
    for (const r of JSON.parse(readFileSync(`scripts/audit_sets/${name}.json`, 'utf8'))) {
      rows.push({ set: name, text: typeof r === 'string' ? r : r.text })
    }
  } catch { /* 없으면 건너뛴다 */ }
}

const lemma = (g) => g.replace(/[0-9#:@]+$/, '')
// 앱과 같은 되돌림 — 표에 없으면 글로스 이름 그대로 발음한다(실측 73.8%가 그렇다).
const PLAIN = /^[가-힣]{1,5}$/
const has = (g) => !!(mouth[g] || mouth[lemma(g)] || PLAIN.test(lemma(g)))
const stat = new Map()
const missing = new Map()
for (const r of rows) {
  const { gloss } = await agent.convert(r.text)
  const s = stat.get(r.set) ?? { g: 0, m: 0 }
  for (const g of gloss) {
    s.g += 1
    if (has(g)) s.m += 1
    else missing.set(g, (missing.get(g) ?? 0) + 1)
  }
  stat.set(r.set, s)
}

console.log('[마우징 수록률] 문장에 나온 글로스 중 입모양이 붙는 비율')
let G = 0
let M = 0
for (const [k, s] of stat) {
  G += s.g; M += s.m
  console.log(`  ${k.padEnd(10)} ${String(s.m).padStart(5)}/${String(s.g).padStart(5)}  ${((s.m / s.g) * 100).toFixed(1)}%`)
}
console.log(`  ${'전체'.padEnd(10)} ${String(M).padStart(5)}/${String(G).padStart(5)}  ${((M / G) * 100).toFixed(1)}%`)
const top = [...missing.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)
console.log('  자주 나오는데 입모양이 없는 글로스:', top.map(([g, n]) => `${g}(${n})`).join(' · '))

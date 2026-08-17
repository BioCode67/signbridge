// 번역 품질 감사 — 문장 묶음을 실제 번역기(브라우저와 같은 코드)에 통과시켜 수치를 낸다.
//
//     node --experimental-strip-types scripts/audit_translation.mjs [문장파일.json]
//
// **왜 필요한가.** 번역 사전은 재난문자 16만 문장쌍에서 뽑았다. 그런데 앱이 노리는
// 자리는 병원·택시·관공서 창구다 — **직원이 하는 말은 재난문자가 아니라 일상어**다.
// "요금은 만 오천 원입니다", "번호표를 뽑고 기다려 주세요" 같은 문장이 얼마나
// 표현되는지는 재난문자 커버리지(93.7%)로는 알 수 없다. 도메인이 바뀌면 다시 재야 한다.
//
// 재는 것
//   낱말 표현률 — 문장의 내용어 중 몇 %가 수어 동작으로 나가는가
//   완전 표현 문장 — 빠진 낱말이 하나도 없는 문장 수
//   미매칭 낱말 — 무엇이 빠지는가(빈도순). 다음에 채울 어휘 목록이 된다
//   재생 불가 글로스 — 번역은 됐는데 동작 사전에 조각이 없는 것(조용한 실패)
//
// 브라우저와 같은 `dictSignAgent.ts`를 그대로 돌린다(Node 22 타입 스트리핑).
// 파이썬으로 다시 구현하면 규칙이 갈라져 수치가 거짓이 된다 — feature_parity와 같은 원칙.
import { readFileSync } from 'node:fs'
import { DictSignAgent } from '../src/agents/dictSignAgent.ts'

const bank = JSON.parse(readFileSync('public/data/bank.json', 'utf8'))
const align = JSON.parse(readFileSync('public/data/align.json', 'utf8'))

// 브라우저 코드는 fetch로 사전을 받는다 — 파일에서 읽어 주는 가짜 fetch를 끼운다.
globalThis.fetch = async () => ({ ok: true, json: async () => align })

const file = process.argv[2]
const sentences = file
  ? JSON.parse(readFileSync(file, 'utf8'))
  : JSON.parse(readFileSync('public/data/feed.json', 'utf8')).map((x) => x.text)

const agent = new DictSignAgent('align.json')

// 내용어만 센다 — 조사·어미만 남은 조각은 애초에 수어로 표현하지 않는다.
const CONTENT_RE = /[가-힣]{2,}/g

let words = 0
let missed = 0
let complete = 0
const missCount = new Map()
const unplayable = new Map()
const worst = []

for (const text of sentences) {
  const { gloss, unmatched } = await agent.convert(text)
  const content = (text.match(CONTENT_RE) ?? []).length
  const miss = unmatched?.length ?? 0
  words += content
  missed += miss
  if (miss === 0) complete++
  for (const w of unmatched ?? []) missCount.set(w, (missCount.get(w) ?? 0) + 1)
  // 번역은 됐는데 조각이 없는 글로스 — 화면상 조용히 사라진다
  for (const g of gloss) if (!bank[g]) unplayable.set(g, (unplayable.get(g) ?? 0) + 1)
  if (miss > 0) worst.push({ text, miss, unmatched, gloss })
}

const rate = 100 * (1 - missed / Math.max(1, words))
console.log(`\n[audit] 문장 ${sentences.length}개 · 내용어 ${words}개`)
console.log(`[audit] 낱말 표현률 ${rate.toFixed(1)}%  (빠진 낱말 ${missed}개)`)
console.log(`[audit] 완전 표현 문장 ${complete}/${sentences.length} (${(100 * complete / sentences.length).toFixed(0)}%)`)

const top = [...missCount.entries()].sort((a, b) => b[1] - a[1])
console.log(`\n[audit] 빠진 낱말 ${top.length}종 — 상위 30`)
console.log('  ' + top.slice(0, 30).map(([w, n]) => `${w}(${n})`).join(' · '))

if (unplayable.size) {
  console.log(`\n[audit] ⚠️ 번역됐지만 동작이 없는 글로스 ${unplayable.size}종`)
  console.log('  ' + [...unplayable.entries()].slice(0, 20).map(([g, n]) => `${g}(${n})`).join(' · '))
}

console.log(`\n[audit] 빠짐이 많은 문장 상위 8`)
for (const w of worst.sort((a, b) => b.miss - a.miss).slice(0, 8)) {
  console.log(`  "${w.text}"`)
  console.log(`    빠짐: ${w.unmatched.join(', ')}`)
  console.log(`    수어: ${w.gloss.map((g) => g.replace(/[0-9#:]+$/, '')).join(' ')}`)
}

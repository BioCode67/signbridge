// 같은 검증 문장으로 **통계 사전**을 재서 학습 모델과 나란히 놓는다.
//
//     python -m ml.eval_t2g --checkpoint ~/sbruns/t2gs-v1 --data ~/sbdata/script
//     node --experimental-strip-types --import ./scripts/ts-register.mjs \
//          scripts/eval_dict_on.mjs
//
// **왜 이 비교가 필요한가.** "학습 모델이 사전보다 낫다"는 말은 재 봐야 성립한다.
// 지금까지 번역 품질을 재는 수단이 낱말 표현률뿐이었는데, 그건 "몇 %가 나갔나"만
// 잰다 — 맞게 나갔는지도, 어순이 맞는지도 모른다. 여기서는 사람 번역가의 글로스열을
// 정답으로 두고 BLEU·F1·어순을 잰다.
//
// 지표는 ml/eval_t2g.py와 **같은 계산**을 쓴다 — 다르면 비교가 성립하지 않는다.
import { readFileSync } from 'node:fs'
import { DictSignAgent } from '../src/agents/dictSignAgent.ts'

const R = 'public/data/'
const align = JSON.parse(readFileSync(R + 'align.json', 'utf8'))
const order = JSON.parse(readFileSync(R + 'order.json', 'utf8'))
const timegloss = JSON.parse(readFileSync(R + 'timegloss.json', 'utf8'))
globalThis.fetch = async (url) => ({
  ok: true,
  json: async () => {
    const u = String(url)
    if (u.includes('order.json')) return order
    if (u.includes('timegloss.json')) return timegloss
    return align
  },
})

const rows = JSON.parse(readFileSync('scripts/t2g_eval_set.json', 'utf8'))
const agent = new DictSignAgent('align.json')

const ngrams = (seq, n) => {
  const m = new Map()
  for (let i = 0; i + n <= seq.length; i += 1) {
    const k = seq.slice(i, i + n).join('')
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return m
}

function corpusBleu(preds, golds, nmax = 4) {
  const match = Array(nmax).fill(0)
  const total = Array(nmax).fill(0)
  let plen = 0
  let glen = 0
  preds.forEach((p, i) => {
    const g = golds[i]
    plen += p.length
    glen += g.length
    for (let n = 1; n <= nmax; n += 1) {
      const pc = ngrams(p, n)
      const gc = ngrams(g, n)
      total[n - 1] += Math.max(0, p.length - n + 1)
      for (const [k, c] of pc) match[n - 1] += Math.min(c, gc.get(k) ?? 0)
    }
  })
  if (Math.min(...total) === 0 || Math.min(...match) === 0) return 0
  const logs = match.reduce((s, m, i) => s + Math.log(m / total[i]), 0) / nmax
  const bp = plen > glen ? 1 : Math.exp(1 - glen / Math.max(1, plen))
  return 100 * bp * Math.exp(logs)
}

function glossF1(preds, golds) {
  let tp = 0
  let fp = 0
  let fn = 0
  preds.forEach((p, i) => {
    const gc = new Map()
    for (const w of golds[i]) gc.set(w, (gc.get(w) ?? 0) + 1)
    let inter = 0
    for (const w of p) {
      const c = gc.get(w) ?? 0
      if (c > 0) {
        inter += 1
        gc.set(w, c - 1)
      }
    }
    tp += inter
    fp += p.length - inter
    fn += golds[i].length - inter
  })
  const prec = tp / Math.max(1, tp + fp)
  const rec = tp / Math.max(1, tp + fn)
  return [100 * prec, 100 * rec, (200 * prec * rec) / Math.max(1e-9, prec + rec)]
}

function kendall(preds, golds) {
  let conc = 0
  let disc = 0
  preds.forEach((p, i) => {
    const pos = new Map()
    golds[i].forEach((w, j) => {
      if (!pos.has(w)) pos.set(w, j)
    })
    const seq = p.filter((w) => pos.has(w)).map((w) => pos.get(w))
    for (let x = 0; x < seq.length; x += 1) {
      for (let y = x + 1; y < seq.length; y += 1) {
        if (seq[y] > seq[x]) conc += 1
        else if (seq[y] < seq[x]) disc += 1
      }
    }
  })
  const tot = conc + disc
  return tot ? (100 * (conc - disc)) / tot : 0
}

const dict = []
const golds = []
const nn = []
for (const r of rows) {
  const { gloss } = await agent.convert(r.text)
  dict.push(gloss)
  golds.push(r.gold)
  nn.push(r.nn)
}

const goldAvg = golds.reduce((s, g) => s + g.length, 0) / golds.length
const show = (label, p) => {
  const [prec, rec, f1] = glossF1(p, golds)
  const avg = p.reduce((s, x) => s + x.length, 0) / p.length
  console.log(`\n[eval] ${label}`)
  console.log(`  BLEU-4      ${corpusBleu(p, golds).toFixed(1)}`)
  console.log(`  글로스 F1   ${f1.toFixed(1)}  (정밀도 ${prec.toFixed(1)} · 재현율 ${rec.toFixed(1)})`)
  console.log(`  어순 상관   ${kendall(p, golds).toFixed(1)}`)
  console.log(`  평균 길이   예측 ${avg.toFixed(1)} / 정답 ${goldAvg.toFixed(1)}`)
}

console.log(`[eval] 같은 검증 문장 ${rows.length}개로 견줍니다`)
show('통계 사전 (지금 앱이 쓰는 것)', dict)
show('학습 모델 (t2gs)', nn)

console.log('\n[eval] 보기 — 원문 / 사람 / 사전 / 모델')
for (let i = 0; i < Math.min(3, rows.length); i += 1) {
  console.log(`  원문: ${rows[i].text.slice(0, 60)}`)
  console.log(`  사람: ${golds[i].slice(0, 14).join(' ')}`)
  console.log(`  사전: ${dict[i].slice(0, 14).join(' ')}`)
  console.log(`  모델: ${nn[i].slice(0, 14).join(' ')}`)
}

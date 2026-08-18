// 고개 동작이 **합성 결과에 실제로 실리는지** 본다.
//
//     node --experimental-strip-types --import ./scripts/ts-register.mjs \
//          scripts/check_nonmanual.mjs
//
// **왜 따로 재나.** 표(`nonmanual.json`)가 있고 아바타가 고개를 돌릴 줄 알아도,
// 그 둘을 잇는 자리에서 끊기면 화면은 멀쩡하다 — 그냥 고개를 안 움직일 뿐이다.
// 실제로 여기서 한 번 끊겼다: 표를 받아 오는 것을 기다리지 않아 **첫 문장에만
// 고개 동작이 안 붙었다.** 두 번째 문장부터 붙으니 눈으로는 잡기 어렵다.
//
// 부정문에 고개 젓기가 빠지면 밋밋한 정도가 아니라 **뜻이 반대로 읽힐 수 있다.**
import { readFileSync } from 'node:fs'

const R = 'public/data/'
const bank = JSON.parse(readFileSync(R + 'bank.json', 'utf8'))
const nonmanual = JSON.parse(readFileSync(R + 'nonmanual.json', 'utf8'))
const align = JSON.parse(readFileSync(R + 'align.json', 'utf8'))
const order = JSON.parse(readFileSync(R + 'order.json', 'utf8'))
const timegloss = JSON.parse(readFileSync(R + 'timegloss.json', 'utf8'))

globalThis.fetch = async (u) => {
  const s = String(u)
  if (s.includes('nonmanual.json')) return { ok: true, json: async () => nonmanual }
  if (s.includes('order.json')) return { ok: true, json: async () => order }
  if (s.includes('timegloss.json')) return { ok: true, json: async () => timegloss }
  if (s.includes('align.json')) return { ok: true, json: async () => align }
  return { ok: false, json: async () => ({}) }
}

const { composeGlosses } = await import('../src/sections/sign/composeLocal.ts')
const { DictSignAgent } = await import('../src/agents/dictSignAgent.ts')
const agent = new DictSignAgent('align.json')
const loadGloss = async (_name, entry) =>
  JSON.parse(readFileSync(R + 'glosses/' + entry.file, 'utf8'))

// **첫 문장이 부정문이다** — 표 로딩 경합이 있으면 여기서 바로 드러난다.
const CASES = [
  { text: '외출을 자제하세요', want: 'shake' },
  { text: '조심하세요', want: 'nod' },
  { text: '불가능합니다', want: 'shake' },
  { text: '거절합니다', want: 'shake' },
  { text: '미안합니다', want: 'nod' },
  { text: '오늘 날씨가 좋네요', want: null },   // 붙지 말아야 하는 문장
]

let failed = 0
for (const c of CASES) {
  const { gloss } = await agent.convert(c.text)
  const data = await composeGlosses(c.text, gloss, bank, loadGloss)
  const heads = (data?.gloss_sequence ?? []).filter((g) => g.head).map((g) => g.head)
  const ok = c.want === null ? heads.length === 0 : heads.includes(c.want)
  if (!ok) {
    failed += 1
    const shown = (data?.gloss_sequence ?? [])
      .map((g) => (g.head ? `${g.gloss}[${g.head}]` : g.gloss)).join(' ')
    console.log(`  ✗ ${c.text} — 기대 ${c.want ?? '없음'} / 실제 ${shown || '(합성 실패)'}`)
  }
}

const total = Object.keys(nonmanual.nod ?? {}).length + Object.keys(nonmanual.shake ?? {}).length
console.log(failed
  ? `\n고개 동작 ${CASES.length - failed}/${CASES.length} 통과 — 이어지는 자리가 끊겼습니다`
  : `\n고개 동작 ✓ ${CASES.length}건 통과 (표에 ${total}종: 끄덕임 ${Object.keys(nonmanual.nod).length} · 젓기 ${Object.keys(nonmanual.shake).length})`)
process.exit(failed ? 1 : 0)

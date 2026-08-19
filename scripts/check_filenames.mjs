// **윈도우에서 풀 수 있는 파일명인가.**
//
//     node scripts/check_filenames.mjs
//
// 왜 따로 재나. 이 앱의 데이터 파일은 이름이 **글로스 그 자체**다(`날짜_10월10일.json`).
// 리눅스와 웹에서는 거의 아무 문자나 쓸 수 있어서, 위험한 이름이 들어가도
// **개발 중에는 끝까지 아무 일도 안 일어난다.**
//
// 실제로 `:`가 1,365개 파일에 들어가 있었다(`날짜:10월10일.json`). 웹에서는 멀쩡했고
// 자동 검사도 전부 통과했다. 그런데 노트북용 zip을 **윈도우에서 풀면** 이렇게 멈춘다:
//
//     오류 0x80070057: 매개 변수가 틀립니다.   시:8시26분.json
//
// 건너뛰면 압축은 풀리지만 **날짜·시각 수어가 통째로 빠진다** — 재난문자에 가장
// 자주 나오는 것들이고, 빠져도 오류가 안 난다. 아바타가 조용히 설 뿐이다.
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// 윈도우 금지 문자 · 예약 이름 · 끝의 점/공백
const BAD_CHAR = /[\\/:*?"<>|]/
const RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i
const BAD_END = /[. ]$/
// `#`은 윈도우에서는 되지만 URL에서 조각 구분자라 fetch가 깨진다
const URL_RISK = /#/

const roots = ['public', 'dist']
let bad = 0
let seen = 0

const walk = (dir) => {
  let entries
  try { entries = readdirSync(dir) } catch { return }
  for (const name of entries) {
    const full = join(dir, name)
    let st
    try { st = statSync(full) } catch { continue }
    seen++
    const why =
      BAD_CHAR.test(name) ? '윈도우 금지 문자' :
      RESERVED.test(name) ? '윈도우 예약 이름' :
      BAD_END.test(name) ? '이름이 점·공백으로 끝남' :
      URL_RISK.test(name) ? 'URL 조각 구분자 #' : null
    if (why) { bad++; if (bad <= 8) console.log(`  ✗ ${full} — ${why}`) }
    if (st.isDirectory()) walk(full)
  }
}

for (const r of roots) walk(r)

// bank.json이 가리키는 이름도 함께 본다 — 파일만 고치고 bank를 두면 조용히 끊긴다
let bankBad = 0
try {
  const bank = JSON.parse(readFileSync('public/data/bank.json', 'utf8'))
  for (const v of Object.values(bank)) {
    const f = v?.file ?? ''
    if (BAD_CHAR.test(f) || URL_RISK.test(f)) bankBad++
  }
} catch { /* 없으면 넘어간다 */ }

if (bad > 8) console.log(`  … 그 밖에 ${bad - 8}개 더`)
if (bankBad) console.log(`  ✗ bank.json의 file 값 ${bankBad}개가 위험한 이름입니다`)

const total = bad + bankBad
console.log(
  total
    ? `\n[파일명] ✗ ${total}건 — 윈도우에서 압축을 풀 수 없습니다 (검사 ${seen.toLocaleString()}개)\n` +
      `         고치려면: python3 ml/tools/fix_gloss_filenames.py --apply`
    : `\n[파일명] ✓ ${seen.toLocaleString()}개 모두 윈도우에서 풀 수 있는 이름입니다`,
)
process.exit(total ? 1 : 0)

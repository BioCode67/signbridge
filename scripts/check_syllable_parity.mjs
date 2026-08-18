// 음절 쪼개기 규약 대조 — 파이썬(학습) ↔ TS(브라우저)
//
//     node --experimental-strip-types --import ./scripts/ts-register.mjs \
//          scripts/check_syllable_parity.mjs
//
// **왜 이 검사가 필요한가.** 소형 번역 모델은 토크나이저 파일이 없다. 입력을
// 음절로 쪼개는 함수 한 줄이 곧 규약이다. `ml/train_t2g_small.py`의 `syllables()`와
// `src/agents/nnSignAgent.ts`의 `syllables()`가 글자 하나라도 다르면
// **"검증 정확도는 좋은데 브라우저에선 엉뚱한 결과"** 가 된다.
// 이 프로젝트에서 가장 찾기 어려운 실패 유형이고(특징 대조와 같은 이유),
// 화면에는 아무 오류도 안 난다.
import { execFileSync } from 'node:child_process'
import { syllablesForTest } from '../src/agents/nnSignAgent.ts'

// 실제 문장에서 어긋나기 쉬운 것들: 공백 여러 개, 탭·줄바꿈, 괄호·기호,
// 숫자·영문 혼용, 자모 분리형(NFD), 이모지, 앞뒤 공백.
const CASES = [
  '오늘 21시부로 한파가 예상됩니다',
  '  앞뒤 공백  과   여러 칸  ',
  '줄바꿈\n과\t탭',
  '10.26(화) 철새도래지 방문 자제',
  'AI 확산방지 ASF 063-460-2570',
  '규모 4.5 지진',
  '한가글 자모 분리형',          // NFD — NFC로 합쳐져야 한다
  '이모지 🚨 섞임',
  '',
  '한',
]

const py = `
import json, sys, unicodedata
sys.path.insert(0, '.')
from ml.train_t2g_small import syllables
data = json.load(sys.stdin)
print(json.dumps([syllables(t) for t in data], ensure_ascii=False))
`
const out = execFileSync('python3', ['-c', py], {
  input: JSON.stringify(CASES), encoding: 'utf8',
})
const fromPy = JSON.parse(out)

let failed = 0
CASES.forEach((text, i) => {
  const ts = syllablesForTest(text)
  const p = fromPy[i]
  const same = ts.length === p.length && ts.every((c, j) => c === p[j])
  if (!same) {
    failed += 1
    console.log(`  ✗ ${JSON.stringify(text)}`)
    console.log(`     파이썬(${p.length}): ${JSON.stringify(p.slice(0, 12))}`)
    console.log(`     TS   (${ts.length}): ${JSON.stringify(ts.slice(0, 12))}`)
  }
})

console.log(failed
  ? `\n음절 규약 어긋남 ${failed}/${CASES.length}건 — 한쪽만 고쳤습니다`
  : `\n음절 규약 일치 ✓ ${CASES.length}건`)
process.exit(failed ? 1 : 0)

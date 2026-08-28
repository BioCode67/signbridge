// 행정구역 이름 목록을 앱이 쓸 수 있는 꼴로 옮긴다.
//
//   node scripts/gen_place_names.mjs
//
// 원본은 `ml/data/place_names.txt`(`ml/tools/fetch_place_names.sh`로 받는다. 키 불필요).
// 앱은 재난문자에서 뽑은 지역 후보가 진짜 지명인지 이 목록으로 대조한다(regionName.ts).
//
// **번들에 싣는 이유.** 배지는 문자가 재생되는 즉시 떠야 해서 fetch를 기다릴 수 없고,
// 오프라인에서도 그대로 동작해야 한다. 24KB(gzip 약 8KB)라 실을 만하다.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'ml/data/place_names.txt')
const OUT = join(ROOT, 'src/data/placeNames.ts')

const names = [...new Set(readFileSync(SRC, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean))].sort()

writeFileSync(OUT, `// 행정구역 이름 — 재난문자에서 뽑은 지역 후보가 **진짜 지명인지** 대조하는 목록.
//
// 원본은 ml/data/place_names.txt(\`ml/tools/fetch_place_names.sh\`로 받는다. 키 불필요).
// 손으로 고치지 말 것 — 원본을 갱신한 뒤 \`node scripts/gen_place_names.mjs\`로 다시 만든다.
//
// 광역 단위는 짧은 꼴(\`대구\`)과 긴 꼴(\`대구광역시\`)이 함께 들어 있다.
// 실제 문자는 \`대구시\`처럼 목록에 없는 표기를 쓰기도 해서, 대조할 때
// **접미사를 뗀 줄기**(\`대구\`)도 함께 본다(regionName.ts).
// ${names.length}개.

export const PLACE_NAMES: ReadonlySet<string> = new Set(
  \`${names.join('\n')}\`.split('\\n'),
)
`)
console.log(`[지명] ${names.length}개 → src/data/placeNames.ts`)

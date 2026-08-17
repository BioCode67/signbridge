// 오프라인 준비 목록을 만든다 — 회선 없이도 대화가 되도록 미리 받아 둘 파일 목록.
//
// **왜 필요한가.** 서비스워커는 지나간 응답만 캐시한다(cache-first 런타임 캐시).
// 그래서 이런 일이 벌어진다: 집에서 앱을 설치하고, 병원 지하 접수창구에서 처음으로
// "어디가 아픕니까?"를 누른다 — 그 동작 조각은 한 번도 받은 적이 없어 캐시에 없고,
// 지하라 회선도 없다. **정작 필요한 순간에 아바타가 서 있는다.** 재난 상황은 더하다:
// 기지국 폭주·정전으로 네트워크가 가장 먼저 끊기는데, 그때 처음 오는 문자를 번역해야 한다.
//
// 그래서 두 단으로 나눈다.
//   필수(essential) — 창구 상용구 글로스 + 고빈도 어휘 300종. 첫 방문 뒤 조용히 받아 둔다.
//   전체(extended)  — 고빈도 1,200종 + 아바타. 사용자가 "오프라인 준비"를 누를 때만.
//
// 고빈도 순서는 `bank.json`의 키 순서를 그대로 쓴다 — export_web_bank가 출현 빈도
// 내림차순으로 기록한다(상위 3,000종이 출현의 96.2%를 덮는다는 실측이 그 근거).
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DIST = 'dist'
const ESSENTIAL_TOP = 300
const EXTENDED_TOP = 1200

const bank = JSON.parse(readFileSync(join(DIST, 'data/bank.json'), 'utf8'))
const keys = Object.keys(bank)

// 장소 상용구가 쓰는 글로스 — 창구 대화는 이것이 없으면 시작조차 못 한다.
// (ml/tools/check_app_glosses.py 가 이 글로스들이 사전에 실존하는지 별도로 검사한다.)
const places = readFileSync('src/user/places.ts', 'utf8')
const phraseGlosses = new Set()
for (const m of places.matchAll(/gloss: \[([^\]]*)\]/g)) {
  for (const g of m[1].split(',')) {
    const name = g.trim().replace(/^'|'$/g, '')
    if (name) phraseGlosses.add(name)
  }
}

const fileOf = (g) => (bank[g] ? `./data/glosses/${bank[g].file}` : null)
const sizeOf = (rel) => {
  try {
    return statSync(join(DIST, rel.replace('./', ''))).size
  } catch {
    return 0
  }
}

const essential = new Set()
// 작은 공통 파일 — 이게 없으면 번역 자체가 안 된다.
for (const f of ['./data/bank.json', './data/align.json', './data/order.json', './data/feed.json'])
  essential.add(f)
for (const g of phraseGlosses) {
  const f = fileOf(g)
  if (f) essential.add(f)
}
for (const g of keys.slice(0, ESSENTIAL_TOP)) {
  const f = fileOf(g)
  if (f) essential.add(f)
}

const extended = new Set()
for (const g of keys.slice(0, EXTENDED_TOP)) {
  const f = fileOf(g)
  if (f && !essential.has(f)) extended.add(f)
}
// 아바타와 인식 모델 — 없으면 오프라인에서 아바타가 아예 뜨지 않고, 수어 입력도 못 쓴다.
//
// 주의할 점 둘, 둘 다 실측에서 걸렸다.
//   1) `models/` 를 한 겹만 읽으면 **디렉터리가 파일 목록에 섞인다**(`models/ksl-iso`).
//      그대로 받으러 가면 404가 나고 "준비됨"인데 정작 인식 모델은 없다. 재귀로 훑는다.
//   2) 아바타는 여섯 종이 들어 있지만 앱은 **기본 하나만** 쓴다. 전부 받으면 7MB를
//      헛되이 쓰므로, 쓰는 것만 싣는다(사용자가 바꾸면 그때 받으면 된다).
const usedAvatar = (
  readFileSync('src/sections/sign/avatars.ts', 'utf8').match(
    /DEFAULT_MODEL_URL = `\$\{BASE\}models\/([^`]+)`/,
  )?.[1] ?? 'real-avaturn.glb'
)
const walk = (rel) => {
  let entries = []
  try {
    entries = readdirSync(join(DIST, rel), { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const child = `${rel}/${e.name}`
    if (e.isDirectory()) walk(child)
    else {
      // 쓰지 않는 아바타(.glb/.bin)는 건너뛴다 — 텍스처는 공유라 그대로 싣는다.
      const isAvatarBody = /\.glb(\.bin)?$/.test(e.name)
      if (isAvatarBody && !e.name.startsWith(usedAvatar)) continue
      extended.add(`./${child}`)
    }
  }
}
walk('models')

const bytes = (list) => [...list].reduce((n, f) => n + sizeOf(f), 0)
const manifest = {
  essential: [...essential],
  extended: [...extended],
  bytes: { essential: bytes(essential), extended: bytes(extended) },
  // 상용구 글로스가 몇 개 포함됐는지 — 목록이 조용히 비는 회귀를 눈으로 잡는다.
  phrases: phraseGlosses.size,
}

// 빌드가 스스로 지키게 한다 — 이 결함들은 조용해서(받는 데 성공한 것처럼 보인다)
// 사람 눈으로는 다시 놓치기 쉽다.
if (manifest.phrases === 0) throw new Error('오프라인 목록: 상용구 글로스를 하나도 찾지 못했습니다')

const all = [...manifest.essential, ...manifest.extended]
const noExt = all.filter((f) => !/\.[a-z0-9]+$/i.test(f))
if (noExt.length) {
  throw new Error(`오프라인 목록에 파일이 아닌 항목이 있습니다(디렉터리는 404가 납니다): ${noExt.join(', ')}`)
}
const zero = all.filter((f) => sizeOf(f) === 0)
if (zero.length) {
  throw new Error(`오프라인 목록에 실제로 없는 파일이 있습니다: ${zero.slice(0, 5).join(', ')}`)
}
if (!all.some((f) => f.includes('ksl-iso/model.onnx'))) {
  throw new Error('오프라인 목록에 인식 모델이 없습니다 — 오프라인에서 수어 입력이 죽습니다')
}

writeFileSync(join(DIST, 'data/offline.json'), JSON.stringify(manifest))
const mb = (n) => (n / 1024 / 1024).toFixed(1)
console.log(
  `[offline] 필수 ${manifest.essential.length}개 ${mb(manifest.bytes.essential)}MB · ` +
    `전체 추가 ${manifest.extended.length}개 ${mb(manifest.bytes.extended)}MB ` +
    `(상용구 글로스 ${manifest.phrases}종 포함)`,
)

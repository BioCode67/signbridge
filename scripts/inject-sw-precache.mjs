// 빌드 산출물 목록을 sw.js의 프리캐시에 주입한다.
//
// 왜 필요한가: 첫 방문의 JS/CSS 로드는 서비스워커 설치 **전**에 일어나 fetch
// 캐시를 타지 않는다. 그 상태로 오프라인이 되면 셸 HTML만 있고 번들이 없어
// 빈 화면이 된다(실측). 그래서 빌드 때 확정되는 자산 목록을 install 프리캐시에
// 넣는다 — JS/CSS(필수 셸)만. 무거운 모델·사전은 런타임 캐시로 충분하다.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'

const assets = readdirSync('dist/assets')
  .filter((f) => f.endsWith('.js') || f.endsWith('.css') || f.endsWith('.wasm'))
  .map((f) => `./assets/${f}`)
const extra = ['./ort/ort-wasm-simd-threaded.wasm', './ort/ort-wasm-simd-threaded.mjs']

// 배포마다 캐시 이름이 달라야 이전 자산이 정리된다 — 번들 해시로 버전을 만든다.
const version = 'sb-' + (assets.find((a) => a.includes('index-'))?.match(/index-([A-Za-z0-9_-]+)/)?.[1] ?? Date.now())

const sw = readFileSync('dist/sw.js', 'utf8').replace("const VERSION = 'sb-v1'", `const VERSION = '${version}'`)
const marker = "const CORE = ['./', './manifest.webmanifest', './icon-192.png', './icon-512.png']"
if (!sw.includes(marker)) throw new Error('sw.js CORE 마커를 찾지 못했습니다 — 프리캐시 주입 실패')
const list = ['./', './manifest.webmanifest', './icon-192.png', './icon-512.png', ...assets, ...extra]
writeFileSync('dist/sw.js', sw.replace(marker, `const CORE = ${JSON.stringify(list)}`))
console.log(`[sw] 프리캐시 ${list.length}개 주입 (assets ${assets.length})`)

// 길찾기 계산 검사 — 거리·방위·어림수·답변 문장.
//
//     node --experimental-strip-types --import ./scripts/ts-register.mjs \
//          scripts/check_nearby.mjs
//
// **왜 따로 재나.** 이 계산이 틀리면 화면은 멀쩡하다 — 화살표도 그려지고 숫자도
// 뜬다. 다만 **엉뚱한 쪽을 가리킨다.** 재난 상황에서 그 오류는 눈으로 못 잡는다.
// 그래서 답을 아는 값(위도 1도 = 약 111km, 정북 = 0도)으로 못 박아 둔다.
import { readFileSync } from 'node:fs'
import {
  distanceM, bearingDeg, directionKo, roundDistance, walkMinutes, nearest,
  answerSentence, answerHeadline, KIND_KO,
} from '../src/user/nearby.ts'

let failed = 0
const ok = (cond, label, detail = '') => {
  if (!cond) { failed += 1; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const near = (a, b, tol, label) => ok(Math.abs(a - b) <= tol, label, `${a.toFixed(2)} vs ${b} (±${tol})`)

// ── 거리: 위도 1도 = 약 111.19km(자오선). 경도 1도는 위도에 따라 줄어든다.
near(distanceM(37, 127, 38, 127), 111195, 300, '위도 1도 = 약 111.2km')
near(distanceM(37.5, 127, 37.5, 128), 88300, 600, '북위 37.5도에서 경도 1도 = 약 88.3km')
near(distanceM(37.5, 127, 37.5, 127), 0, 0.001, '같은 자리는 0m')
// 100m 규모 — 실제로 이 앱이 다루는 크기다
near(distanceM(37.5, 127, 37.5009, 127), 100, 2, '위도 0.0009도 = 약 100m')

// ── 방위: 정북 0 · 정동 90 · 정남 180 · 정서 270
near(bearingDeg(37.5, 127, 37.6, 127), 0, 0.1, '정북 = 0도')
near(bearingDeg(37.5, 127, 37.5, 127.1), 90, 0.1, '정동 = 90도')
near(bearingDeg(37.5, 127, 37.4, 127), 180, 0.1, '정남 = 180도')
near(bearingDeg(37.5, 127, 37.5, 126.9), 270, 0.1, '정서 = 270도')

// ── 8방위 경계 — 45도씩. 경계에서 옆 방위로 새면 45도(=거리의 76%)를 틀린다.
const dirCases = [[0, '북'], [22, '북'], [23, '북동'], [45, '북동'], [90, '동'],
  [135, '남동'], [180, '남'], [225, '남서'], [270, '서'], [315, '북서'], [359, '북']]
for (const [deg, want] of dirCases) {
  ok(directionKo(deg).ko === want, `${deg}도 → ${want}`, directionKo(deg).ko)
}
ok(directionKo(-90).ko === '서', '음수 각도도 정규화', directionKo(-90).ko)
ok(directionKo(450).ko === '동', '360도 넘는 각도도 정규화', directionKo(450).ko)

// ── 어림수 — 수어로 읽을 수 있어야 한다. 247미터를 자릿수대로 읽으면 못 따라온다.
const rc = [[7, '10미터'], [43, '40미터'], [96, '100미터'], [247, '250미터'],
  [960, '950미터'], [1240, '1.2킬로미터'], [12400, '12.4킬로미터']]
for (const [m, want] of rc) {
  ok(roundDistance(m).text === want, `${m}m → ${want}`, roundDistance(m).text)
}
ok(walkMinutes(20) >= 1, '아주 가까워도 최소 1분')
ok(walkMinutes(4000) === 60, '4km = 60분', String(walkMinutes(4000)))

// ── 가까운 순 정렬 — 갈래를 지정하면 그 갈래만 나와야 한다
const places = [
  { name: 'A병원', kind: 'hospital', lat: 37.5010, lon: 127.0 },
  { name: 'B학교', kind: 'shelter', lat: 37.5005, lon: 127.0 },
  { name: 'C학교', kind: 'shelter', lat: 37.5100, lon: 127.0 },
]
const sh = nearest(places, 37.5, 127.0, 'shelter', 3)
ok(sh.length === 2, '대피소만 걸러짐', String(sh.length))
ok(sh[0].name === 'B학교', '가까운 것이 먼저', sh[0]?.name)
ok(sh[0].distance < sh[1].distance, '거리 오름차순')
ok(nearest(places, 37.5, 127.0, null, 9).length === 3, '갈래 null이면 전부')

// ── 답변 문장이 실제로 수어가 되는가 — 여기서 끊기면 아바타가 조용히 선다
const align = JSON.parse(readFileSync('public/data/align.json', 'utf8'))
const order = JSON.parse(readFileSync('public/data/order.json', 'utf8'))
globalThis.fetch = async (url) => ({
  ok: true, json: async () => (String(url).includes('order.json') ? order : align),
})
const { DictSignAgent } = await import('../src/agents/dictSignAgent.ts')
const agent = new DictSignAgent('align.json')
const lemma = (g) => g.replace(/[0-9#:@]+$/, '')

for (const kind of Object.keys(KIND_KO)) {
  for (const deg of [0, 45, 90, 135, 180, 225, 270, 315]) {
    const t = { name: '테스트', kind, lat: 0, lon: 0, distance: 250, bearing: deg }
    const sent = answerSentence(t)
    const { gloss } = await agent.convert(sent)
    const lemmas = gloss.map(lemma)
    // 방향·갈래·거리가 모두 살아 있어야 답이 성립한다
    const dir = directionKo(deg)
    ok(lemmas.some((g) => g.startsWith(dir.ko)), `${kind}/${dir.ko}: 방향이 표현됨`, sent + ' → ' + gloss.join(' '))
    ok(lemmas.includes(lemma(KIND_KO[kind].gloss)) || lemmas.includes(KIND_KO[kind].gloss),
      `${kind}/${dir.ko}: 갈래가 표현됨`, sent + ' → ' + gloss.join(' '))
    ok(gloss.length >= 3, `${kind}/${dir.ko}: 낱말이 3개 이상`, gloss.join(' '))
    // 과거 실측 오역 — "북동쪽"이 통째로 'km 지진 크기'가 됐다
    ok(!lemmas.includes('지진'), `${kind}/${dir.ko}: '지진'이 섞이지 않음`, gloss.join(' '))
    ok(answerHeadline(t).includes('테스트'), '사람이 읽는 줄에 이름이 남음')
  }
}

// ── 실제 데이터 — 목록이 실려 있고 갈래가 갖춰졌는가
const data = JSON.parse(readFileSync('public/data/nearby.json', 'utf8'))
ok(data.places.length > 100, '장소 목록이 실려 있음', String(data.places.length))
ok(typeof data.official === 'boolean', 'official 표기가 있음')
ok(typeof data.source === 'string' && data.source.length > 0, '출처 문구가 있음')
const kinds = new Set(data.places.map((p) => p.kind))
for (const k of ['shelter', 'hospital', 'pharmacy']) ok(kinds.has(k), `${k} 갈래가 있음`)
ok(data.places.every((p) => p.lat > 32 && p.lat < 40 && p.lon > 124 && p.lon < 132),
  '좌표가 한반도 안에 있음')
ok(data.places.every((p) => p.name && p.name.length > 0), '이름 없는 장소가 없음')

console.log(failed ? `\n길찾기 검사 실패 ${failed}건` : '\n길찾기 검사 ✓ 전부 통과')
process.exit(failed ? 1 : 0)

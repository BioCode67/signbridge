// 재난문자에서 뽑은 **지역 이름이 진짜 지명인가** 검사.
//
//   node --experimental-strip-types --import ./scripts/ts-register.mjs scripts/check_region.mjs
//
// **왜 재는가.** 뽑은 이름이 화면 배지로 뜬다. 한국어에는 행정단위와 글자가 겹치는
// 낱말이 아주 많아서, 글자 모양만 보면 전부 지역처럼 생겼다 —
// `야외활동`(동) · `놀이기구`(구) · `해수면`(면) · `적어도`(도) · `발생하면`(면).
//
// 2026-08-28 실측: 정규식 한 줄로 뽑았더니 표본 246건에서 **71종 중 22종이 지역이
// 아니었다.** 화면에 `📍 야외활동`이 떴다는 뜻이다. 오류도 경고도 안 난다 —
// 글자가 그럴듯해서 눈으로 훑어도 안 걸린다. 그래서 수치로 잰다.
//
// 이 검사는 두 가지를 본다.
//   1. 뽑힌 값이 **전부** 행정구역 목록에 있는가(오탐 0)
//   2. 반드시 맞혀야 하는 사례를 맞히는가(놓침 방지)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { regionOf, REGION_NAMES } from '../src/user/regionName.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// 반드시 이렇게 나와야 하는 것 — 실제 문자에서 뽑았다.
const MUST = [
  ['[대구시청] 20일 대구시 달성군 [화산재 낙하 예정] 문이나 창문을 닫고', '대구시'],
  ['[서울특별시청] 7시 서울특별시 관악구 8명 승강기 추락으로 인해 사망', '서울특별시'],
  // 발신 기관명만 있고 본문에 지역이 없는 문자 — `청` 때문에 버리면 통째로 빈다.
  ['[부산광역시청] 등산객 5명 추락. 등산 중 호흡곤란이 발생하면', '부산광역시'],
  ['[강원도청] 등산객 3명 실종. 등산 중 호흡곤란이 발생하면', '강원도'],
  // 접미사 없는 줄임꼴.
  ['오늘 10시30분 경북 해안 해일 경보, 야외활동 자제', '경북'],
  ['오늘 17시 광주지역 미세먼지 경보발령, 실외활동 금지', '광주'],
  // 긴 줄기를 먼저 본다 — `운대`+`구`가 아니라 `해운대`+`구`.
  ['해운대구 해수욕장 인근 통제', '해운대구'],
  ['8월 13일 22:49 경북 포항시 북쪽 6km 지역 규모 3.1 지진발생', '포항시'],
  ['오늘 강원도 강릉시 지역 강릉댐 댐 물이 넘칠 위험이 있으니', '강원도'],
]

// 절대 지역으로 뽑히면 안 되는 것 — 전부 실제 문자에서 나온 오탐이다.
const NEVER = [
  '금일 16시 인천, 충북, 세종, 경기일부 미세먼지 경보, 야외활동 자제바랍니다',
  '[행정안전부] 공중 놀이기구 관련 주의사항 : 매달림형이나 좌석형과 같이',
  '대조기(10월 18일). 해수면 상승에 따라 해안가 주민들은 안전에 유의하세요',
  '[행정안전부] 화상부위를 흐르는 찬물 속에 넣어 적어도 10분 동안 담그시기',
  '금일 관내 제한급수 및 단수가 예상되오니 시민들께서는 급수시 까지',
  '침수로 통제했던 지방도 747호선 월천교를 안전하게 복구하여',
  '고농도 미세 먼지 비상저감조치 발령, 실외활동자제, 마스크 착용 바랍니다',
  '[행정안전부] 과호흡증후군 응급처치 방법 및 증상 판별',
  '현재 우리군 해일주의보. 해안가저지대 주민들께서는',
  '금일 10시~15시까지 하천변 헬기방역실시. 인근주민께서는',
]
// NEVER 중 오탐 낱말이 지역으로 잘못 뽑혔는지 보려면, 그 낱말이 답이면 안 된다.
const NEVER_WORDS = new Set([
  '야외활동', '실외활동', '놀이기구', '해수면', '적어도', '급수시', '지방도',
  '고농도', '과호흡증후군', '우리군', '우리시', '헬기방역실시', '발생하면',
  '있으면', '잡히면', '외출시', '발견시', '무엇보다도', '눈치우기에도',
  '산행시에도', '송학지하차도', '울릉도독도',
])

let fails = 0
const bad = (label, detail) => { fails++; console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`) }
const ok = (label, detail) => console.log(`  ✓ ${label}${detail ? ' — ' + detail : ''}`)

console.log('\n[지역] 반드시 맞혀야 하는 사례')
let mustOk = 0
for (const [text, want] of MUST) {
  const got = regionOf(text)
  if (got === want) mustOk++
  else bad(`"${want}" 기대`, `실제 ${got ?? '없음'} · ${text.slice(0, 34)}`)
}
if (mustOk === MUST.length) ok(`${mustOk}/${MUST.length} 통과`)

console.log('\n[지역] 오탐이 없어야 하는 사례')
let neverOk = 0
for (const text of NEVER) {
  const got = regionOf(text)
  if (got && NEVER_WORDS.has(got)) bad(`오탐 "${got}"`, text.slice(0, 40))
  else neverOk++
}
if (neverOk === NEVER.length) ok(`${neverOk}/${NEVER.length} 통과`)

// 표본 전체 — 뽑힌 값이 하나라도 행정구역 목록 밖이면 실패.
// 목록에 없는 표기(`대구시`)는 접미사를 뗀 줄기로도 본다(regionName.ts와 같은 규칙).
console.log('\n[지역] 표본 전체에서 뽑힌 값이 모두 실제 지명인가')
const SUFFIXES = ['특별자치도', '특별자치시', '특별시', '광역시', '시', '군', '구', '도', '동', '읍', '면']
const isReal = (name) => {
  if (REGION_NAMES.has(name)) return true
  for (const s of SUFFIXES) {
    if (name.endsWith(s) && name.length > s.length && REGION_NAMES.has(name.slice(0, -s.length))) return true
  }
  return false
}

const feed = JSON.parse(readFileSync(join(ROOT, 'public/data/feed.json'), 'utf8'))
const found = new Map()
for (const x of feed) {
  const r = regionOf(x.text)
  if (r) found.set(r, (found.get(r) ?? 0) + 1)
}
const fake = [...found.keys()].filter((n) => !isReal(n)).sort()
if (fake.length) bad(`지명이 아닌 값 ${fake.length}종`, fake.join(' · '))
else ok(`${found.size}종 전부 실제 지명`, `문자 ${[...found.values()].reduce((a, b) => a + b, 0)}/${feed.length}건에서 추출`)

// 뽑히는 비율이 갑자기 무너지면(사전 교체·정규식 수정) 알아채야 한다.
const rate = [...found.values()].reduce((a, b) => a + b, 0) / feed.length
if (rate < 0.35) bad('추출률이 너무 낮다', `${(rate * 100).toFixed(1)}% — 지역이 거의 안 뜬다`)
else ok('추출률', `${(rate * 100).toFixed(1)}%`)

console.log(fails ? `\n[지역] ✗ 실패 ${fails}건\n` : '\n[지역] ✓ 전부 통과\n')
process.exit(fails ? 1 : 0)

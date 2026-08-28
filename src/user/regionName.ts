// 재난문자 본문에서 **지역 이름**을 뽑는다.
//
// **이게 왜 조심스러운 일인가.** 뽑은 이름이 화면에 배지로 뜬다. 그런데 한국어에는
// 행정단위와 글자가 겹치는 낱말이 아주 많다 — `야외활동`(동) · `놀이기구`(구) ·
// `해수면`(면) · `적어도`(도) · `발생하면`(면) · `외출시`(시). 글자 모양만 보면
// 전부 지역처럼 생겼다.
//
// 예전에는 정규식 하나로 끝냈다. 실측(2026-08-28)에서 표본 246건에 돌려 보니
// **뽑힌 71종 중 22종이 지역이 아니었다.** 화면에 `📍 야외활동`, `📍 놀이기구`가
// 떴다는 뜻이다. 오류도 경고도 없다 — 글자가 그럴듯해서 눈으로도 잘 안 걸린다.
//
// 그래서 지금은 **행정구역 이름 목록과 대조해서** 통과한 것만 쓴다.
//
// 목록에 없는 표기를 쓰는 문자가 있다. `[대구시청]`은 스스로를 `대구시`라 적는데
// 목록에는 `대구`와 `대구광역시`만 있다. 그래서 **접미사를 뗀 줄기도 함께** 본다.
import { PLACE_NAMES } from '../data/placeNames'

// 광역자치단체 17곳은 **손으로 못박는다.** 받아 온 목록에 구멍이 있었다 —
// `전라남도`·`전라북도`·`전남`이 통째로 빠져 있어서, 목록만 믿으면 전남 지역 문자에
// 지역이 안 뜬다(2026-08-28 실측). 광역 단위는 개수가 고정이고 바뀌지 않으므로
// 목록에 기대지 않는 편이 낫다. 줄임꼴(`전남`)도 함께 둔다 — 문자마다 표기가 다르고,
// 줄기 대조에도 쓰인다(`대구시` → 줄기 `대구`).
const WIDE_AREAS = [
  '서울특별시', '부산광역시', '대구광역시', '인천광역시', '광주광역시',
  '대전광역시', '울산광역시', '세종특별자치시',
  '경기도', '강원특별자치도', '강원도', '충청북도', '충청남도',
  '전북특별자치도', '전라북도', '전라남도', '경상북도', '경상남도', '제주특별자치도',
  '서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종',
  '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주',
] as const

/** 지역으로 인정하는 이름 전체. 검사(scripts/check_region.mjs)도 이 목록을 본다 —
 *  목록을 두 벌 두면 한쪽만 고쳐져 검사가 조용히 어긋난다(실제로 한 번 그랬다). */
export const REGION_NAMES: ReadonlySet<string> = new Set([...PLACE_NAMES, ...WIDE_AREAS])

/** 행정단위 접미사. 긴 것부터 본다 — `세종특별자치시`를 `세종특별자치`+`시`로 자르지 않기 위해. */
const SUFFIXES = [
  '특별자치도', '특별자치시', '특별시', '광역시',
  '시', '군', '구', '도', '동', '읍', '면',
] as const

/** 줄기 길이 — 최소 2글자(`대구`), 최대 6글자(`제주특별자치`는 접미사 쪽에서 처리). */
const MIN_STEM = 2
const MAX_STEM = 6

const HANGUL = /^[가-힣]+$/

/**
 * 문장에서 처음 나오는 **진짜 지역 이름**을 돌려준다. 없으면 undefined.
 *
 * 판정 규칙
 *   1. 접미사 뒤가 한글이면 낱말 중간이다 → 버린다(`대구시청`의 `대구시`).
 *   2. 줄기는 긴 것부터 본다(`해운대`+`구` → `해운대구`가 `운대`+`구`보다 먼저).
 *   3. 통째로(`서울특별시`) 또는 줄기만(`대구`) 목록에 있으면 지역으로 본다.
 */
export function regionOf(text: string, known: ReadonlySet<string> = REGION_NAMES): string | undefined {
  for (let i = 0; i < text.length; i++) {
    for (const sfx of SUFFIXES) {
      if (!text.startsWith(sfx, i)) continue
      // 규칙 1 — 접미사 뒤가 한글이면 낱말 중간이다.
      //
      // 다만 **발신 기관명은 예외**다. 재난문자는 `[부산광역시청] 등산객 5명 추락…`처럼
      // 머리에 보낸 곳을 적는데, 본문에 지역이 한 번도 안 나오는 문자가 많다.
      // `청` 하나 때문에 버리면 그 문자들은 지역이 통째로 비어 버린다(실측 4건).
      // `시청`·`도청`·`군청`·`구청`만 받는다.
      const next = text[i + sfx.length]
      const isOffice = next === '청' && !HANGUL.test(text[i + sfx.length + 1] ?? '')
      if (!isOffice && next && HANGUL.test(next)) continue
      // 규칙 2 — 긴 줄기부터.
      for (let len = MAX_STEM; len >= MIN_STEM; len--) {
        if (i - len < 0) continue
        const stem = text.slice(i - len, i)
        if (!HANGUL.test(stem)) continue
        const whole = stem + sfx
        // 규칙 3 — 통째로 또는 줄기만 목록에 있으면 통과.
        if (known.has(whole) || known.has(stem)) return whole
      }
    }
  }
  // 접미사가 안 붙은 줄임꼴 — `경북 해안 해일 경보` · `광주지역 미세먼지`.
  // 광역 단위 이름만 본다(개수가 고정이라 안전하다). 시·군·구까지 이렇게 받으면
  // `광명`·`영천` 같은 두 글자가 아무 낱말에나 걸린다.
  return bareWideArea(text)
}

/** 뒤에 붙어도 지역으로 읽히는 말. `경기일부`·`광주지역`을 살리기 위한 최소 목록. */
const AREA_TAIL = ['지역', '일대', '전역', '일부']

function bareWideArea(text: string): string | undefined {
  for (let i = 0; i < text.length; i++) {
    for (const name of WIDE_AREAS) {
      if (!text.startsWith(name, i)) continue
      // 앞이 한글이면 낱말 중간이다(`경기` ← `호경기`).
      if (HANGUL.test(text[i - 1] ?? '')) continue
      const rest = text.slice(i + name.length)
      if (!HANGUL.test(rest[0] ?? '') || AREA_TAIL.some((t) => rest.startsWith(t))) return name
    }
  }
  return undefined
}

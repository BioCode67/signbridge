// 주변 장소 — "대피소 어디?"에 **위치로** 답하기 위한 데이터·거리 계산.
//
// **왜 이 화면이 필요한가.** 재난 문자는 "OO초등학교로 대피하세요"라고 하지만,
// 그 학교가 어디인지는 알려주지 않는다. 들을 수 있는 사람은 지나가는 사람에게
// 물어서 해결한다 — 농인에게는 그 한 마디가 막혀 있다. 그래서 이 앱에서는
// **묻는 것 자체를 수어로** 하고, 답을 **방향과 거리**로 돌려준다.
//
// 설계 원칙 두 가지.
//
// 1) **오프라인에서 동작해야 한다.** 재난 때 가장 먼저 끊기는 것이 통신이다.
//    지도 타일을 받아오는 방식은 정작 필요한 순간에 빈 화면이 된다. 그래서
//    장소 목록을 기기에 미리 저장해 두고, 화면에는 타일 대신 **방위와 거리**를
//    직접 그린다(ShelterMap). 나침반이 있으면 내가 보는 쪽을 기준으로 돌려 준다.
//
// 2) **출처를 속이지 않는다.** 여기 실리는 목록이 행정안전부 **공식 지정** 목록인지,
//    참고용 샘플인지 데이터 파일이 스스로 밝히고(`official`), 화면이 그대로 표시한다.
//    "잘못된 정보는 없는 것보다 나쁘다" — 대피소는 특히 그렇다.
//
// 실제 배포 때는 `python3 ml/tools/fetch_shelters.py --key <공공데이터포털 키>`로
// 행정안전부 표준데이터를 받아 `public/data/nearby.json`을 교체한다.

/** 장소 갈래 — 수어 질문에서 이 갈래를 알아낸다(askIntent.ts). */
export type PlaceKind = 'shelter' | 'hospital' | 'pharmacy' | 'police' | 'subway' | 'toilet'

export interface NearbyPlace {
  /** 이름 — 화면에 글자로 띄운다. 고유명사는 지문자가 없어 수어로 못 쓴다. */
  name: string
  kind: PlaceKind
  lat: number
  lon: number
  /** 있으면 표시 — 주소는 주변 사람에게 보여줄 때 쓴다 */
  addr?: string
  /** 수용 인원 등 부가 정보(공식 대피소 데이터에 들어 있다) */
  note?: string
}

export interface NearbyData {
  /** 이 목록이 공식 지정 목록인가. false면 화면에 '참고용'을 명시한다. */
  official: boolean
  /** 출처 문구 — 화면 하단에 그대로 노출한다 */
  source: string
  /** 받은 날짜(YYYY-MM-DD) */
  updated: string
  places: NearbyPlace[]
}

export const KIND_KO: Record<PlaceKind, { label: string; icon: string; gloss: string }> = {
  // gloss는 **동작 사전에 실존하는** 낱말이어야 한다(check_app_glosses가 검사한다).
  shelter: { label: '대피소', icon: '🏫', gloss: '대피' },
  hospital: { label: '병원', icon: '🏥', gloss: '병원' },
  pharmacy: { label: '약국', icon: '💊', gloss: '약국' },
  police: { label: '경찰서', icon: '🚓', gloss: '경찰서' },
  subway: { label: '지하철역', icon: '🚇', gloss: '지하철' },
  toilet: { label: '화장실', icon: '🚻', gloss: '화장실' },
}

// ── 거리·방위 ───────────────────────────────────────────────────────
const R = 6371000 // m
const rad = (d: number) => (d * Math.PI) / 180

/** 두 좌표 사이 거리(m) — 하버사인. 수백 m 규모에서는 오차가 무시할 수준이다. */
export function distanceM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = rad(bLat - aLat)
  const dLon = rad(bLon - aLon)
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** 진북 기준 방위각(0~360, 북=0, 동=90). */
export function bearingDeg(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const φ1 = rad(aLat), φ2 = rad(bLat), Δλ = rad(bLon - aLon)
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}

/** 8방위 한국어 — 수어로도 표현되는 낱말만 쓴다(동·서·남·북은 동작 사전에 있다).
 *  '북동'처럼 붙여 쓰면 사전에 없으므로 **두 낱말로** 돌려준다("북 동"). */
const DIRS: { max: number; ko: string; glosses: string[] }[] = [
  { max: 22.5, ko: '북', glosses: ['북'] },
  { max: 67.5, ko: '북동', glosses: ['북', '동'] },
  { max: 112.5, ko: '동', glosses: ['동'] },
  { max: 157.5, ko: '남동', glosses: ['남', '동'] },
  { max: 202.5, ko: '남', glosses: ['남'] },
  { max: 247.5, ko: '남서', glosses: ['남', '서'] },
  { max: 292.5, ko: '서', glosses: ['서'] },
  { max: 337.5, ko: '북서', glosses: ['북', '서'] },
  { max: 360.1, ko: '북', glosses: ['북'] },
]

export function directionKo(deg: number): { ko: string; glosses: string[] } {
  const d = ((deg % 360) + 360) % 360
  return DIRS.find((x) => d < x.max) ?? DIRS[0]
}

/** 거리 표기 — 수어로 읽을 수 있게 **어림수**로 만든다.
 *  "247미터"를 자릿수대로 수어로 하면 읽는 쪽이 못 따라온다.
 *  걸어가는 사람에게 필요한 정확도는 어차피 그 정도가 아니다. */
export function roundDistance(m: number): { text: string; number: string; unit: string } {
  if (m < 100) {
    const n = Math.max(10, Math.round(m / 10) * 10)
    return { text: `${n}미터`, number: String(n), unit: '미터' }
  }
  if (m < 1000) {
    const n = Math.round(m / 50) * 50
    return { text: `${n}미터`, number: String(n), unit: '미터' }
  }
  const km = Math.round(m / 100) / 10
  return { text: `${km}킬로미터`, number: String(km), unit: '킬로미터' }
}

/** 걷는 시간(분) — 시속 4km 기준. 거리보다 시간이 더 잘 와닿는다. */
export function walkMinutes(m: number): number {
  return Math.max(1, Math.round(m / (4000 / 60)))
}

export interface Ranked extends NearbyPlace {
  distance: number
  bearing: number
}

/** 내 위치에서 가까운 순으로 — 갈래를 지정하면 그 갈래만. */
export function nearest(
  places: NearbyPlace[],
  lat: number,
  lon: number,
  kind: PlaceKind | null,
  limit = 3,
): Ranked[] {
  return places
    .filter((p) => kind === null || p.kind === kind)
    .map((p) => ({
      ...p,
      distance: distanceM(lat, lon, p.lat, p.lon),
      bearing: bearingDeg(lat, lon, p.lat, p.lon),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
}

// ── 답변 문장 ───────────────────────────────────────────────────────
//
// 아바타가 수어로 낼 문장이라, **동작 사전에 있는 낱말로만** 짓는다.
// 고유명사(한빛초등학교)는 지문자가 없어 수어로 못 쓰므로 문장에서 빼고
// 화면에 낱말 카드로 크게 띄운다 — 정보를 잃지 않으면서 거짓 수어도 내지 않는다.
//
// 어순은 dictSignAgent가 말뭉치에서 잰 어순표로 다시 잡는다. 여기서는
// 한국어 문장만 만든다.

/** 갈래별 마무리 — 대피소는 "대피하세요", 나머지는 "있어요". */
const TAIL: Record<PlaceKind, string> = {
  shelter: '대피하세요',
  hospital: '병원 있어요',
  pharmacy: '약국 있어요',
  police: '경찰서 있어요',
  subway: '지하철 있어요',
  toilet: '화장실 있어요',
}

export function answerSentence(p: Ranked): string {
  const dir = directionKo(p.bearing)
  const dist = roundDistance(p.distance)
  return `${dir.ko}쪽 ${dist.text} ${TAIL[p.kind]}`
}

/** 화면에 크게 띄우는 한 줄 — 이름이 들어간 **사람이 읽는** 문장. */
export function answerHeadline(p: Ranked): string {
  const dir = directionKo(p.bearing)
  const dist = roundDistance(p.distance)
  return `${dir.ko}쪽 ${dist.text} · ${p.name}`
}

/** 데이터 로드 — 없으면 null(화면이 "목록이 없어요"로 안내한다). */
export async function loadNearby(baseUrl: string): Promise<NearbyData | null> {
  try {
    const r = await fetch(`${baseUrl}data/nearby.json`)
    if (!r.ok) return null
    const d = (await r.json()) as NearbyData
    return Array.isArray(d?.places) && d.places.length > 0 ? d : null
  } catch {
    return null
  }
}

// 재난별 행동요령 — 행정안전부 국민행동요령을 짧은 문장으로 간추린 것.
// (출처: 행정안전부 국민재난안전포털 국민행동요령. 문장은 수어 번역이 잘 되도록
//  간결한 명령형으로 다듬었다.)
//
// 받기 화면에서 재난문자를 보다가 "행동요령"을 누르면 이 문장들을 수어로 이어 본다.
// 문장 단위로 재생하는 이유: 한 문장씩 확인하고 넘어가는 쪽이 급박한 상황에서
// 기억에 남는다 — 긴 문단 통재생은 흘러가 버린다.

export interface SafetyGuide {
  /** 재난문자 분류 코드(feed category) 목록 — 여러 코드가 한 요령을 공유한다. */
  codes: string[]
  name: string
  icon: string
  steps: string[]
}

export const SAFETY_GUIDES: SafetyGuide[] = [
  {
    codes: ['EARTHQUAKE'], name: '지진', icon: '🌏',
    steps: [
      '탁자 아래로 들어가 몸을 보호하세요.',
      '흔들림이 멈추면 전기와 가스를 차단하세요.',
      '엘리베이터를 타지 말고 계단으로 대피하세요.',
      '운동장이나 공원 등 넓은 곳으로 가세요.',
    ],
  },
  {
    codes: ['HEAVYRAIN', 'DELUGEFLOOD', 'FLOODING', 'DAMBREAK'], name: '호우·침수', icon: '🌊',
    steps: [
      '지하 공간과 하천 근처를 피하세요.',
      '높은 곳으로 대피하세요.',
      '물이 차오르면 즉시 건물 밖으로 나오세요.',
      '침수된 도로는 걷지 마세요.',
    ],
  },
  {
    codes: ['TYPHOON', 'STRONGWIND', 'WINDWAVES'], name: '태풍·강풍', icon: '🌀',
    steps: [
      '외출을 자제하고 실내에 머무르세요.',
      '창문을 닫고 창문에서 떨어져 있으세요.',
      '간판과 나무 아래를 피하세요.',
      '해안가에 가지 마세요.',
    ],
  },
  {
    codes: ['FIRE', 'FORESTFIRE', 'EXPLOSION'], name: '화재', icon: '🔥',
    steps: [
      '젖은 수건으로 코와 입을 막으세요.',
      '몸을 낮추고 벽을 따라 대피하세요.',
      '엘리베이터를 타지 말고 계단으로 가세요.',
      '밖으로 나온 뒤 다시 들어가지 마세요.',
    ],
  },
  {
    codes: ['COLDWAVE', 'HEAVYSNOW'], name: '한파·대설', icon: '❄️',
    steps: [
      '외출을 줄이고 따뜻하게 입으세요.',
      '수도꼭지를 조금 틀어 동파를 막으세요.',
      '빙판길을 조심하세요.',
      '노약자는 실내에 머무르세요.',
    ],
  },
  {
    codes: ['LANDSLIDE'], name: '산사태', icon: '⛰️',
    steps: [
      '산 근처를 피해 안전한 곳으로 대피하세요.',
      '집 근처 배수로를 미리 점검하세요.',
      '이상한 소리가 나면 즉시 대피하세요.',
    ],
  },
  {
    codes: ['FINEDUST'], name: '미세먼지', icon: '😷',
    steps: [
      '외출할 때 마스크를 쓰세요.',
      '외출 후 손과 얼굴을 씻으세요.',
      '창문을 닫고 공기청정기를 사용하세요.',
    ],
  },
  {
    codes: ['PREVENTIONOFINFECTIOUSDISEASES', 'ANIMALDISEASE'], name: '감염병', icon: '🧼',
    steps: [
      '손을 자주 씻으세요.',
      '사람이 많은 곳에서는 마스크를 쓰세요.',
      '열이 나면 병원에 가세요.',
    ],
  },
  {
    codes: ['POWEROUTAGESANDPOWERSHORTAGES', 'ELECTRICGASACCIDENT'], name: '정전·전기', icon: '🔌',
    steps: [
      '전열기 플러그를 뽑으세요.',
      '냉장고 문을 자주 열지 마세요.',
      '전선이 끊어져 있으면 만지지 마세요.',
    ],
  },
  {
    codes: ['CHEMICALACCIDENT'], name: '화학사고', icon: '☣️',
    steps: [
      '사고 장소에서 바람 반대 방향으로 대피하세요.',
      '창문을 닫고 외부 공기를 막으세요.',
      '젖은 수건으로 코와 입을 가리세요.',
    ],
  },
  {
    codes: ['CIVILAIRDEFENSEALERT'], name: '민방위', icon: '🚨',
    steps: [
      '가까운 지하 대피소로 이동하세요.',
      '안내 방송과 문자를 계속 확인하세요.',
      '차량은 도로 오른쪽에 세우세요.',
    ],
  },
]

/** 분류 코드로 행동요령을 찾는다. 없으면 null — 억지로 엉뚱한 요령을 보여주지 않는다. */
export function guideFor(category?: string): SafetyGuide | null {
  if (!category) return null
  return SAFETY_GUIDES.find((g) => g.codes.includes(category)) ?? null
}

// Q&A 언어 백본 추상화.
// 기본은 오프라인 템플릿(네트워크 의존 0, 데모 무중단). 실서비스/고도화 시
// KoGPT2 등 생성 모델 백본으로 교체(같은 인터페이스). Step5에서 HTTP 백본을 붙인다.
import type { DisasterAssessment, GeoContext } from './types'

export interface BackboneContext {
  assessment: DisasterAssessment
  geo?: GeoContext
}

export interface LanguageBackbone {
  readonly name: string
  /** 질문 + 재난/위치 컨텍스트 → 자연어 응답. */
  generate(question: string, ctx: BackboneContext): Promise<string>
}

// ── 오프라인 템플릿 백본 ────────────────────────────────────────────────
// 재난 종류 × 질문 의도(대피/대피소/차량/정전/일반)별 응답 지식베이스.
type Intent = 'evacuate' | 'shelter' | 'vehicle' | 'power' | 'safety' | 'general'

function classifyIntent(q: string): Intent {
  if (/대피소|어디|가까운/.test(q)) return 'shelter'
  if (/대피|나가|피해야|이동/.test(q)) return 'evacuate'
  if (/차|차량|주차/.test(q)) return 'vehicle'
  if (/정전|전기|불\s*꺼/.test(q)) return 'power'
  if (/안전|어떻게|행동|해야/.test(q)) return 'safety'
  return 'general'
}

const BASE: Record<string, Partial<Record<Intent, string>>> = {
  지진: {
    safety:
      '흔들리는 동안에는 책상 아래로 몸을 숨기고 머리와 목을 보호하세요. 흔들림이 멈추면 가스·전기를 차단하고 넓은 공터로 대피하세요. 엘리베이터는 사용하지 마세요.',
    evacuate:
      '흔들림이 멈춘 뒤 계단으로 건물을 빠져나와 운동장·공원 등 넓은 공터로 이동하세요. 떨어지는 물건과 유리창을 피하세요.',
    shelter: '가장 가까운 지진 옥외대피장소(넓은 공터·학교 운동장)로 이동하세요. 건물·담장에서 떨어져 대기하세요.',
  },
  호우: {
    evacuate:
      '현재 위치는 침수 위험이 있습니다. 지하·반지하에서는 즉시 나오고 고지대나 가까운 대피소로 이동하세요. 하천·지하차도 접근은 피하세요.',
    shelter: '가까운 지정 대피소(주민센터·복지관·학교)로 큰길을 따라 이동하세요. 저지대·하천변 도로는 피하세요.',
    vehicle: '지하주차장·하천변 주차는 침수 위험이 큽니다. 차량은 고지대로 옮기고 도보로 대피하세요. 수심 30cm 도로는 매우 위험합니다.',
    power: '정전 시 엘리베이터를 타지 말고 계단을 이용하세요. 침수 시 누전 위험이 있으니 차단기를 내려 주세요.',
  },
  화재: {
    safety: '연기를 피해 젖은 천으로 코와 입을 막고 자세를 낮춰 이동하세요. 엘리베이터 대신 계단으로 대피하세요.',
    evacuate: '불길·연기 반대 방향의 비상계단으로 신속히 대피하세요. 문을 만졌을 때 뜨거우면 열지 말고 다른 경로를 찾으세요.',
  },
  산불: {
    evacuate: '산불은 바람 반대 방향, 낮은 지대로 대피하세요. 계곡·수풀은 피하고 도로를 따라 신속히 벗어나세요.',
    safety: '창문·문을 닫아 연기 유입을 막고, 대피 안내에 따라 즉시 이동하세요.',
  },
}

const GENERIC: Record<Intent, string> = {
  evacuate: '안내에 따라 안전한 경로로 즉시 대피하세요. 지하·저지대·위험 구조물을 피하세요.',
  shelter: '가장 가까운 지정 대피소로 이동하세요. 위치 안내가 필요하면 재난 안내 채널을 확인하세요.',
  vehicle: '차량은 안전한 고지대에 두고 도보로 대피하는 것이 안전합니다.',
  power: '정전 시 엘리베이터 사용을 피하고 계단을 이용하세요. 배터리를 아끼고 재난문자 수신을 유지하세요.',
  safety: '침착하게 주변 안전을 확인하고, 재난 안내 방송·문자의 행동요령을 따르세요.',
  general: '현재 재난 상황의 행동요령을 따르고, 안전한 장소로 이동하세요. 추가 안내를 계속 확인하세요.',
}

export class TemplateBackbone implements LanguageBackbone {
  readonly name = 'template'
  async generate(question: string, ctx: BackboneContext): Promise<string> {
    const intent = classifyIntent(question)
    const byType = BASE[ctx.assessment.type]
    const body = byType?.[intent] ?? byType?.safety ?? GENERIC[intent]
    const loc = ctx.geo?.region ? `현재 위치(${ctx.geo.region}) 기준, ` : ''
    return `${loc}${body}`
  }
}

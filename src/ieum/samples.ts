// 이음 시연용 예시 문서 6건.
//
// **값의 출처.** `answer`는 예시 데이터셋의 정답표(answer.json)에서 그대로
// 옮긴 것이다 — Studio 워크플로우(Document Parse → Extract → Solar)가 이 문서에서
// 내야 하는 항목이다. 여기서 Studio를 실시간으로 부르지는 않는다(화면에도 그렇게 쓴다).
//
// **쉬운 안내 문장(`guide`).** 워크플로우의 easy_guide 출력은 저장돼 있지 않아
// 정답표의 값만 다시 말하는 문장을 손으로 썼다. 낱말은 번역 사전(DictSignAgent)이
// 실제로 수어로 낼 수 있는 것으로 골랐다 — 고른 과정에서 버린 표현:
//
//     더 낼 돈이 없습니다   → 더 돈      (부정이 사라져 뜻이 뒤집힌다)
//     집 안에 있으세요     → 집 아니다 있다  ('안'이 부정으로 나간다)
//     약은 세 가지입니다   → 약 가다
//     바로 대피하세요     → 바 대피
//
// 문서는 전부 시연용 **가상 문서**다(기관·인물·번호는 실제와 관계없다).

export type Urgency = '높음' | '보통' | '낮음' | '검토 필요'

export interface IeumAnswer {
  doc_type: string
  issuer: string | null
  amount_krw: number | null
  due_date: string | null
  contact: string | null
  medication_names: string[]
  urgency: Urgency
}

export interface IeumSample {
  id: string
  /** 정답표의 case_id · 데이터셋 파일 번호 */
  caseId: string
  set: string
  /** 고르기 단추에 쓰는 짧은 이름 */
  label: string
  icon: string
  /** 원본 문서 이름(정답표의 documents) */
  title: string
  image: string
  /** 원본이 여러 쪽일 때 화면에 보이는 쪽 안내 */
  pageNote?: string
  answer: IeumAnswer
  /** 긴급도가 왜 그렇게 나오는지 — 문서에 적힌 사실만 */
  urgencyNote: string
  /** 쉬운 안내 — 한 문장씩 아바타가 수어로 한다 */
  guide: string[]
}

export const IEUM_SAMPLES: IeumSample[] = [
  {
    id: 'receipt',
    caseId: 'A',
    set: 'set01',
    label: '병원 영수증',
    icon: '🧾',
    title: '진료비 영수증',
    image: 'ieum/receipt.webp',
    answer: {
      doc_type: '의료_영수증',
      issuer: '한빛내과의원',
      amount_krw: 13000,
      due_date: null,
      contact: '053-421-7710',
      medication_names: [],
      urgency: '낮음',
    },
    urgencyNote: '이미 낸 돈의 영수증이라 할 일이 없습니다.',
    guide: [
      '병원에서 돈을 낸 서류입니다.',
      '한빛내과의원에서 준 서류입니다.',
      '돈 13,000원은 이미 냈습니다.',
      '급하지 않습니다.',
    ],
  },
  {
    id: 'medication',
    caseId: 'B',
    set: 'set02',
    label: '복약안내문',
    icon: '💊',
    title: '복약안내문',
    image: 'ieum/medication.webp',
    answer: {
      doc_type: '의료_처방복약',
      issuer: '새솔약국',
      amount_krw: 5500,
      due_date: null,
      contact: '053-422-3050',
      medication_names: ['아목시실린캡슐 500mg', '이부프로펜정 200mg', '레바미피드정 100mg'],
      urgency: '보통',
    },
    urgencyNote: '약 먹는 방법이 적혀 있어 읽어야 하지만, 기한이 있는 서류는 아닙니다.',
    guide: [
      '약 먹는 방법 안내 서류입니다.',
      '새솔약국에서 준 서류입니다.',
      '약은 3개입니다.',
      '돈은 5,500원입니다.',
      '모르면 약국에 전화하세요.',
    ],
  },
  {
    id: 'water-bill',
    caseId: 'C',
    set: 'set03',
    label: '요금 고지서',
    icon: '🚰',
    title: '상하수도요금 고지서',
    image: 'ieum/water-bill.webp',
    answer: {
      doc_type: '납부_고지서',
      issuer: '가람시 상수도사업본부',
      amount_krw: 32480,
      due_date: '2026-11-25',
      contact: '053-120-3000',
      medication_names: [],
      urgency: '보통',
    },
    urgencyNote: '내야 할 돈과 기한이 있습니다.',
    guide: [
      '수도 요금 서류입니다.',
      '가람시 상수도사업본부에서 보낸 서류입니다.',
      '11월 25일까지 32,480원을 내세요.',
      '모르면 전화로 물어보세요.',
    ],
  },
  {
    id: 'fine-notice',
    caseId: 'L',
    set: 'set12',
    label: '과태료 통지서',
    icon: '🚗',
    title: '과태료 사전통지서 (1쪽만 받은 경우)',
    image: 'ieum/fine-notice.webp',
    answer: {
      doc_type: '납부_고지서',
      issuer: '가람시청 교통행정과',
      amount_krw: null,
      due_date: '2026-11-27',
      contact: '053-120-5821',
      medication_names: [],
      urgency: '검토 필요',
    },
    urgencyNote: '금액이 2쪽에 있는데 1쪽만 있습니다. 워크플로우는 금액을 지어내지 않고 「검토 필요」로 넘깁니다.',
    guide: [
      '주차 위반 과태료 서류입니다.',
      '가람시청 교통행정과에서 보낸 서류입니다.',
      '11월 27일까지 해야 합니다.',
      '돈이 얼마인지 모릅니다.',
      '확인이 필요합니다.',
      '시청에 전화해서 물어보세요.',
    ],
  },
  {
    id: 'welfare',
    caseId: 'G',
    set: 'set07',
    label: '복지 안내문',
    icon: '🏛️',
    title: '복지사업 신청 안내문 · 보조기기 지원 신청서(양식)',
    image: 'ieum/welfare.webp',
    pageNote: '원본 3쪽 중 1쪽',
    answer: {
      doc_type: '행정_복지안내',
      issuer: '가람시 중앙동 행정복지센터',
      amount_krw: null,
      due_date: '2026-11-28',
      contact: '053-120-4455',
      medication_names: [],
      urgency: '보통',
    },
    urgencyNote: '신청 기한이 있습니다.',
    guide: [
      '복지 신청 안내 서류입니다.',
      '가람시 중앙동 행정복지센터에서 보낸 서류입니다.',
      '11월 28일까지 신청하세요.',
      '모르면 행정복지센터에 물어보세요.',
    ],
  },
  {
    id: 'typhoon',
    caseId: 'F',
    set: 'set06',
    label: '재난 안내문',
    icon: '🌀',
    title: '태풍 행동요령 안내문',
    image: 'ieum/typhoon.webp',
    answer: {
      doc_type: '재난_안전안내',
      issuer: '가람시 재난안전대책본부',
      amount_krw: null,
      due_date: null,
      contact: '053-120-0119',
      medication_names: [],
      urgency: '높음',
    },
    urgencyNote: '안전과 관련된 안내라 바로 읽어야 합니다.',
    guide: [
      '태풍 안내 서류입니다.',
      '가람시 재난안전대책본부에서 보낸 서류입니다.',
      '매우 급합니다.',
      '지금 확인하세요.',
    ],
  },
]

/** 수어로 바꿀 때 쓰는 문장 — 천 단위 쉼표를 뗀다.
 *
 *  번역 사전은 `13,000원`의 쉼표에서 수를 끊어 `십 삼 공 원`으로 읽는다(실측).
 *  쉼표를 떼면 `일 만 삼 천 원`으로 맞게 나간다. 화면에는 쉼표 있는 원문을 보여 준다. */
export function toSignText(sentence: string): string {
  return sentence.replace(/(\d),(?=\d{3})/g, '$1')
}

export const STUDIO_URL = 'https://studio.upstage.ai/library/agt_WfFHHFUaWNkPb6gBXtZDXD'

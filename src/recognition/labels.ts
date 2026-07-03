// 재난 도메인 한국수어(KSL) 인식 대상 키워드 30종.
// GRU 분류기의 출력 클래스이자 자막 토큰 사전이다.
// 순서 = 클래스 인덱스이므로 학습·추론·모델 저장이 모두 이 배열에 종속된다.
// (중간 삽입 금지 — 뒤에만 추가하고 모델을 재학습할 것.)
export const KSL_LABELS = [
  '지진',
  '태풍',
  '호우',
  '침수',
  '산불',
  '화재',
  '대피',
  '대피소',
  '안전',
  '위험',
  '경보',
  '주의',
  '도움',
  '구조',
  '부상',
  '병원',
  '정전',
  '지금',
  '이동',
  '흔들림',
  '무너짐',
  '폭발',
  '연기',
  '강풍',
  '폭염',
  '한파',
  '미세먼지',
  '해일',
  '눈사태',
  '안내',
] as const

export type KslLabel = (typeof KSL_LABELS)[number]

export const NUM_CLASSES = KSL_LABELS.length

// 인식 신뢰도가 이 값 미만이면 자막에 확정하지 않고 "인식 중"으로 둔다.
export const CONFIDENCE_THRESHOLD = 0.6

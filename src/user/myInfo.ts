// 내 정보 — 응급실·창구에서 **말 대신 보여주는** 나에 대한 사실들.
//
// **왜 필요한가.** 응급 상황에서 가장 먼저 필요한 것은 통역이 아니라 정보다.
// 의식이 흐리거나 손을 다쳐 수어를 할 수 없을 때, 혈액형·지병·복용 약·알레르기·
// 보호자 연락처는 **화면에 떠 있기만 해도** 의료진이 읽고 조치할 수 있다.
// 농인이 응급실에서 겪는 어려움 중 큰 몫이 "설명할 방법이 없어서"다.
//
// 이 정보는 **기기에만 저장되고 어디로도 전송되지 않는다.** 민감정보이므로 화면에도
// 그렇게 적는다 — 적어 두라고 권하려면 어디에 남는지부터 밝혀야 한다.
export interface MyInfoField {
  key: string
  label: string
  /** 입력 도움말 — 무엇을 적어야 하는지 예시로 보여준다 */
  hint: string
  /** 응급 화면에 크게 띄울 항목(비어 있으면 표시하지 않는다) */
  urgent?: boolean
}

export const MY_INFO_FIELDS: MyInfoField[] = [
  { key: 'name', label: '이름', hint: '홍길동', urgent: true },
  { key: 'birth', label: '생년월일', hint: '1990-01-01' },
  { key: 'blood', label: '혈액형', hint: 'A형 Rh+', urgent: true },
  { key: 'disease', label: '앓고 있는 병', hint: '당뇨, 고혈압', urgent: true },
  { key: 'medicine', label: '먹는 약', hint: '혈압약(아침 1회)', urgent: true },
  { key: 'allergy', label: '알레르기', hint: '페니실린, 새우', urgent: true },
  { key: 'guardian', label: '보호자 이름', hint: '홍부모' },
  { key: 'guardianTel', label: '보호자 연락처', hint: '010-0000-0000', urgent: true },
  { key: 'address', label: '주소', hint: '경산시 대학로 280' },
  { key: 'note', label: '더 알릴 것', hint: '수어통역이 필요합니다' },
]

export type MyInfo = Record<string, string>

const KEY = 'sb-myinfo'

export function loadMyInfo(): MyInfo {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return typeof raw === 'object' && raw ? (raw as MyInfo) : {}
  } catch {
    return {}
  }
}

export function saveMyInfo(info: MyInfo): void {
  localStorage.setItem(KEY, JSON.stringify(info))
}

/** 채워진 항목이 하나라도 있는가 — 없으면 응급 화면에 빈 카드를 띄우지 않는다. */
export function hasMyInfo(info: MyInfo): boolean {
  return MY_INFO_FIELDS.some((f) => (info[f.key] ?? '').trim().length > 0)
}

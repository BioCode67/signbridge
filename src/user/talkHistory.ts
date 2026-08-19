// 지난 대화 보관 — 병원에서 들은 말을 나중에 다시 확인한다.
//
// **왜 필요한가.** 창구에서 오간 말 중에는 나중에 꼭 다시 봐야 하는 것이 있다.
// "3일 뒤에 다시 오세요", "하루 세 번 식후에", "다음 진료는 화요일" — 하필 이런 것이
// 가장 잊기 쉽다. 통역사가 있었다면 메모라도 남았겠지만, 혼자 갔다면 남는 것이 없다.
//
// **저장은 반드시 사용자가 눌러야 한다.** 자동으로 쌓으면 창구·키오스크처럼 여러 사람이
// 돌려 쓰는 기기에서 앞사람의 진료 내용이 다음 사람에게 남는다. 의료 정보라 더더욱
// 그렇다. 그래서 기본은 저장하지 않음이고, 저장한 것도 기기 밖으로 나가지 않는다.
export interface SavedTurn {
  who: 'staff' | 'deaf'
  text: string
  time: string
}

export interface SavedTalk {
  id: string
  place: string
  placeIcon: string
  date: string
  turns: SavedTurn[]
}

const KEY = 'sb-talks'
/** 보관 개수 — 오래된 것부터 지운다. 너무 많이 쌓아 두는 것도 위험이다. */
const MAX = 10

export function loadTalks(): SavedTalk[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(raw) ? (raw as SavedTalk[]) : []
  } catch {
    return []
  }
}

export function saveTalk(talk: Omit<SavedTalk, 'id' | 'date'>): SavedTalk[] {
  const now = new Date()
  const entry: SavedTalk = {
    ...talk,
    id: String(now.getTime()),
    date: `${now.getMonth() + 1}월 ${now.getDate()}일 ${now.toTimeString().slice(0, 5)}`,
  }
  const next = [entry, ...loadTalks()].slice(0, MAX)
  localStorage.setItem(KEY, JSON.stringify(next))
  return next
}

export function deleteTalk(id: string): SavedTalk[] {
  const next = loadTalks().filter((t) => t.id !== id)
  localStorage.setItem(KEY, JSON.stringify(next))
  return next
}

export function clearTalks(): SavedTalk[] {
  localStorage.removeItem(KEY)
  return []
}

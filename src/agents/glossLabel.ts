// 글로스 ID → 사람이 읽는 이름.
//
// 동작 사전의 키는 "조심1", "병원1@", "층0"처럼 **표제어 + 변이 표시**로 돼 있다.
// 화면에 그대로 내보내면 숫자와 기호가 따라붙어 읽기 어렵다. 한 곳에서 떼어낸다 —
// 예전에는 파일마다 정규식을 따로 적어 두어, `@`가 붙은 여덟 낱말만 기호가 남았다.
const TAIL = /[0-9#:@]+$/

/** 화면에 보여 줄 이름. 번호만으로 이뤄진 글로스(숫자 수어)는 그대로 둔다. */
export function glossLabel(gloss: string): string {
  const label = gloss.replace(TAIL, '')
  return label || gloss
}

/** 변이형을 묶을 때 쓰는 표제어(글로스 '조심1'과 '조심2'는 같은 낱말이다). */
export const glossLemma = glossLabel

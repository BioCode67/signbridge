// 글로스열 → 말이 되는 한국어. **농인이 수어로 답한 것을 직원이 듣는 쪽**이다.
//
// **왜 필요한가.** 수어 인식은 낱말을 하나씩 내놓는다. 그대로 소리로 내보내면
// "머리 어제 아프다"가 스피커에서 나온다. 뜻은 통하지만 창구 직원은 한 번 더 되묻게 되고,
// 농인은 자기 말이 서툴게 들렸다고 느낀다. **말이 되는 문장으로 다듬어 내보내는 것**이
// 예의이자 정확성이다.
//
// 제대로 하려면 글로스→한국어 복원 모델(KoBART, `ml/train_gloss2text.py`)이 필요하고
// 그건 서버가 있어야 한다. 서버 없이 도는 이 앱에서는 **용언을 공손형으로 활용하고
// 이어 붙이는** 최소한만 한다. 어미 없이 나열하는 것보다는 확실히 낫고, 틀려도
// 알아들을 수 있는 범위에 머문다(문장을 지어내지 않는다 — 있는 낱말만 잇는다).
//
// 서버가 붙으면 이 함수 자리에 KoBART 복원을 끼우면 된다.


const JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ'
/** 어간 끝 모음 + 아/어 가 한 글자로 합쳐질 때의 모음 */
const FUSE: Record<string, string> = { ㅣ: 'ㅕ', ㅗ: 'ㅘ', ㅜ: 'ㅝ', ㅚ: 'ㅙ' }
const BRIGHT = new Set(['ㅏ', 'ㅗ', 'ㅑ', 'ㅛ'])

function decompose(ch: string): [number, number, number] | null {
  const code = ch.charCodeAt(0) - 0xac00
  if (code < 0 || code >= 11172) return null
  return [Math.floor(code / 588), Math.floor((code % 588) / 28), code % 28]
}

function compose(cho: number, jung: number, jong: number): string {
  return String.fromCharCode(0xac00 + cho * 588 + jung * 28 + jong)
}

/** 용언 어간을 공손형으로: 아프 → 아파요 · 가 → 가요 · 먹 → 먹어요 · 하 → 해요 */
export function polite(stem: string): string {
  const parts = stem.length ? decompose(stem[stem.length - 1]) : null
  if (!parts) return `${stem}요`
  const [cho, jung, jong] = parts
  const vowel = JUNG[jung]
  if (stem.endsWith('하')) return `${stem.slice(0, -1)}해요`
  if (jong) {
    // 받침이 있으면 합쳐지지 않는다: 먹 + 어요 → 먹어요
    return stem + (BRIGHT.has(vowel) ? '아요' : '어요')
  }
  if (vowel === 'ㅡ' && stem.length >= 2) {
    // ㅡ 탈락 — 아프 → 아파. 붙는 모음은 앞 음절이 정한다.
    const prev = decompose(stem[stem.length - 2])
    const bright = prev !== null && BRIGHT.has(JUNG[prev[1]])
    return `${stem.slice(0, -1)}${compose(cho, JUNG.indexOf(bright ? 'ㅏ' : 'ㅓ'), 0)}요`
  }
  if (['ㅏ', 'ㅓ', 'ㅐ', 'ㅔ'].includes(vowel)) return `${stem}요` // 가 + 아 → 가
  const fused = FUSE[vowel]
  if (fused) return `${stem.slice(0, -1)}${compose(cho, JUNG.indexOf(fused), 0)}요`
  return `${stem}요`
}

/** 이어지는 용언: 가 → 가고 */
function connective(stem: string): string {
  return `${stem}고`
}

const isVerb = (lemma: string) => lemma.length >= 2 && lemma.endsWith('다')

/**
 * 글로스열을 읽어 줄 만한 한국어로 만든다.
 *
 * 규칙은 셋뿐이다 — 지어내지 않기 위해 일부러 적게 둔다.
 *   1) 글로스 번호를 뗀다(아프다1 → 아프다)
 *   2) 마지막 용언은 공손형으로(아프다 → 아파요), 앞의 용언은 이어지는 형태로(가다 → 가고)
 *   3) 나머지는 그대로 띄어 쓴다
 */
export function glossesToKorean(glosses: string[]): string {
  const lemmas = glosses.map((g) => g.replace(/[0-9#:]+$/, '')).filter(Boolean)
  if (lemmas.length === 0) return ''
  const lastVerb = lemmas.map(isVerb).lastIndexOf(true)
  const words = lemmas.map((lemma, i) => {
    if (!isVerb(lemma)) return lemma
    const stem = lemma.slice(0, -1)
    return i === lastVerb ? polite(stem) : connective(stem)
  })
  // 용언이 하나도 없으면 낱말 나열이다 — "요"를 붙여 말끝을 맺어 준다.
  if (lastVerb < 0) return `${words.join(' ')}요`
  // '하다'는 앞 명사에 붙여 쓴다: "계산 해요" → "계산해요".
  const joined: string[] = []
  for (let i = 0; i < words.length; i++) {
    const isHada = lemmas[i] === '하다' && joined.length > 0 && !isVerb(lemmas[i - 1])
    if (isHada) joined[joined.length - 1] += words[i]
    else joined.push(words[i])
  }
  return joined.join(' ')
}

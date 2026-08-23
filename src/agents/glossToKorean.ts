import { glossLabel } from './glossLabel'
import { readableGloss } from '../sections/sign/mouthing'
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

  // **불규칙 몇 개는 손으로 못박는다.** 규칙대로 굴리면 스피커에서
  // "고맙아요"·"아녀요"가 나간다 — 창구에서 농인의 말이 서툴게 들린다.
  // 자주 쓰는 것만 넣는다(지어내지 않는다).
  const FIXED: Record<string, string> = {
    아니: '아니에요',
    고맙: '고마워요',
    반갑: '반가워요',
    춥: '추워요',
    덥: '더워요',
    맵: '매워요',
    무섭: '무서워요',
    아프: '아파요',
    낫: '나아요',
    붓: '부어요',
    걷: '걸어요',
    듣: '들어요',
    묻: '물어요',
    돕: '도와요',
    있: '있어요',
    없: '없어요',
    괜찮: '괜찮아요',
    모르: '몰라요',
    부르: '불러요',
    빠르: '빨라요',
  }
  if (FIXED[stem]) return FIXED[stem]

  if (jong) {
    // 받침이 있으면 합쳐지지 않는다: 먹 + 어요 → 먹어요
    return stem + (BRIGHT.has(vowel) ? '아요' : '어요')
  }
  if (vowel === 'ㅡ' && stem.length === 1) {
    // 한 음절 ㅡ 어간 — 쓰 → 써 · 크 → 커 · 뜨 → 떠. 앞 음절이 없어 밝기를
    // 물어볼 데가 없다. 실측에서 "이름 쓰다"가 **"이름 쓰요"** 로 나갔다.
    return `${compose(cho, JUNG.indexOf('ㅓ'), 0)}요`
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

/** 의문사는 "요"가 아니라 "예요/이에요"로 맺는다 — "이름 무엇요"는 말이 안 된다. */
const QUESTION: Record<string, string> = {
  무엇: '뭐예요',
  어디: '어디예요',
  언제: '언제예요',
  누구: '누구예요',
  얼마: '얼마예요',
  몇: '몇이에요',
  왜: '왜요',
  어떻게: '어떻게 해요',
}

/** 자릿수 읽기 글로스 — 이어지면 한 수로 붙여 읽는다. */
const DIGIT_WORD = new Set(['공', '영', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'])

/** 앞 용언을 부정하는 글로스 — 뒤에 붙어 온다(`먹다 아니다`). */
const NEG_AFTER: Record<string, 'not' | 'dont' | 'cant'> = {
  아니다: 'not',   // 안 —  약 안 먹어요
  하지마: 'dont',  // -지 마세요
  못하다: 'cant',  // 못 —  못 가요 ("안 가요"와 뜻이 다르다)
}

/** `안`·`못`을 붙이면 **비문이 되는** 용언 — 따로 있는 말을 쓴다. */
const NEG_LEXICAL: Record<string, string> = {
  알다: '몰라요',   // "안 알아요"는 한국어가 아니다
  있다: '없어요',
}

/**
 * 글로스열을 읽어 줄 만한 한국어로 만든다.
 *
 * 규칙은 셋뿐이다 — 지어내지 않기 위해 일부러 적게 둔다.
 *   1) 글로스 번호를 뗀다(아프다1 → 아프다)
 *   2) 마지막 용언은 공손형으로(아프다 → 아파요), 앞의 용언은 이어지는 형태로(가다 → 가고)
 *   3) 나머지는 그대로 띄어 쓴다
 */
export function glossesToKorean(glosses: string[]): string {
  let lemmas = glosses
    .map((g) => {
      // **글로스 이름을 그대로 소리로 내보내지 않는다.** `시:4시`·`날짜:2월22일`은
      // 낱말이 아니라 전용 동작의 이름이다. 실측에서 직원이 스피커로
      // **"시콜론사시 와요"** 를 들었다 — 농인은 자기 말이 어떻게 전달됐는지
      // 볼 수 없으므로 이런 자리는 눈으로 안 잡힌다.
      if (g.includes(':')) return readableGloss(g) ?? ''
      return glossLabel(g)
    })
    .filter(Boolean)
  if (lemmas.length === 0) return ''

  // **자릿수 읽기는 붙여 읽는다.** `일 일 구 신고` → "119 신고". 셋 이상일 때만
  // 붙인다 — `이 일`(2일)처럼 수사와 단위가 이웃한 자리를 삼키지 않기 위해서다.
  const merged: string[] = []
  for (let i = 0; i < lemmas.length; i++) {
    let j = i
    while (j < lemmas.length && DIGIT_WORD.has(lemmas[j])) j++
    if (j - i >= 3) { merged.push(lemmas.slice(i, j).join('')); i = j - 1 }
    else merged.push(lemmas[i])
  }
  lemmas = merged

  // **부정은 앞 용언에 붙인다.** 수어는 [먹다][아니다] 순인데 한국어로 그대로
  // 늘어놓으면 "약 먹고 아니에요"가 되어 뜻이 뭉개진다. 창구에서 이건
  // "약을 안 먹었다"인지 아닌지가 갈리는 자리다.
  const negated: string[] = []
  for (let i = 0; i < lemmas.length; i++) {
    const kind = NEG_AFTER[lemmas[i]]
    const prev = negated[negated.length - 1]
    if (kind && prev && isVerb(prev)) {
      negated[negated.length - 1] = `\u0000${kind}:${prev}`
      continue
    }
    negated.push(lemmas[i])
  }
  lemmas = negated
  const negKind = (l: string) =>
    l.startsWith('\u0000') ? l.slice(1, l.indexOf(':')) : null
  const bare = (l: string) => (negKind(l) ? l.slice(l.indexOf(':') + 1) : l)
  const lastVerb = lemmas.map((l) => isVerb(bare(l))).lastIndexOf(true)
  /** 문장을 맺는 말 — 맨 뒤로 보낼 자리를 여기서 표시해 둔다. */
  let endWord: string | null = null
  const words = lemmas.map((lemma, i) => {
    const kind = negKind(lemma)
    const plain = bare(lemma)
    if (!isVerb(plain)) return plain
    const stem = plain.slice(0, -1)
    const mark = (w: string) => { if (i === lastVerb) endWord = w; return w }
    if (kind === 'dont') return mark(`${stem}지 마세요`)
    if (kind && NEG_LEXICAL[plain]) return mark(NEG_LEXICAL[plain])
    const body = i === lastVerb ? polite(stem) : connective(stem)
    if (kind === 'not') return mark(`안 ${body}`)
    if (kind === 'cant') return mark(`못 ${body}`)
    return mark(body)
  })
  // 용언이 하나도 없으면 낱말 나열이다 — 말끝을 맺어 준다.
  // **마지막이 의문사면 물음으로 맺는다**("이름 무엇요" → "이름 뭐예요?").
  if (lastVerb < 0) {
    const last = bare(lemmas[lemmas.length - 1])
    if (QUESTION[last]) {
      const head = words.slice(0, -1).join(' ')
      return head ? `${head} ${QUESTION[last]}?` : `${QUESTION[last]}?`
    }
    return `${words.join(' ')}요`
  }
  // **`원하다`는 앞 용언에 `-고 싶어요`로 붙인다.** 수어는 [가다][원하다] 순인데
  // 그대로 이으면 "화장실 가고 원해요"가 나온다. 창구에서 농인의 답이 서툴게
  // 들리는 자리다 — 붙이면 "화장실 가고 싶어요"가 된다.
  for (let i = 1; i < words.length; i++) {
    if (bare(lemmas[i]) !== '원하다' || !isVerb(bare(lemmas[i - 1]))) continue
    words[i - 1] = `${bare(lemmas[i - 1]).slice(0, -1)}고 싶어요`
    endWord = words[i - 1]
    words.splice(i, 1)
    lemmas.splice(i, 1)
    break
  }

  // '하다'는 앞 명사에 붙여 쓴다: "계산 해요" → "계산해요".
  const joined: string[] = []
  for (let i = 0; i < words.length; i++) {
    const isHada = bare(lemmas[i]) === '하다' && joined.length > 0 && !isVerb(bare(lemmas[i - 1]))
    if (isHada) joined[joined.length - 1] += words[i]
    else joined.push(words[i])
  }
  // **조사는 앞 낱말에 붙여 읽는다.** 수어 낱말로 따로 나온 `부터`·`까지`를
  // 띄어 읽으면 "어제 부터 아파요"가 되어 또박또박 끊긴다.
  const CLING = new Set(['부터', '까지', '처럼', '만큼', '보다', '마다'])
  const clung: string[] = []
  for (const w of joined) {
    if (CLING.has(w) && clung.length) clung[clung.length - 1] += w
    else clung.push(w)
  }

  // **맺는 용언을 맨 뒤로 보낸다.** 한국어는 용언이 끝에 온다 — 수어 어순
  // 그대로 읽으면 "아파요 어제부터"가 스피커에서 나온다. 낱말을 지어내는 것이
  // 아니라 **있는 낱말의 자리만** 바꾸는 것이라 뜻이 달라지지 않는다.
  //
  // 맺는 말을 **끝글자로 찾지 않는다** — `중요`처럼 `요`로 끝나는 명사가 걸린다.
  // 활용할 때 표시해 둔 자리(`endWord`)를 그대로 쓴다.
  const endAt = endWord === null ? -1 : clung.indexOf(endWord)
  if (endAt >= 0 && endAt < clung.length - 1) {
    const [verb] = clung.splice(endAt, 1)
    clung.push(verb)
  }
  return clung.join(' ')
}

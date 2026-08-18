"""한글 ↔ 자모. **지문자(FS)를 자모열로 다루기 위한 것.**

지문자는 낱말을 자모 하나씩 손으로 쓴다. 그래서 지문자 클립의 라벨은 낱말
하나(`충정로`)지만, 손이 실제로 만드는 것은 자모 여덟 개(ㅊ ㅜ ㅇ ㅈ ㅓ ㅇ ㄹ ㅗ)다.

**이 분해가 왜 중요한가.** 낱말을 통째로 분류하면 배운 1,022개 지명만 알아듣는다.
자모열로 CTC를 학습하면 **배우지 않은 이름도 읽는다** — 지문자를 쓰는 이유가
원래 그것이다(이름·지명은 수어 단어가 없다).

실측으로 뒷받침된다. CROWD 지문자 라벨 17,000클립에서

    자모 개수 ↔ 표시 구간 길이  상관 r = 0.845 (자모당 약 0.5초)

즉 라벨이 낱말 하나여도 실제 동작은 자모 하나씩이다. 자모 37종이 133,986회
나온다(가장 흔한 ㅇ 16,881 · 가장 드문 ㄻ 17).

**받침 겹자음을 풀지 않는다.** `ㄻ`을 `ㄹ`+`ㅁ`으로 풀면 손 모양 하나에 자모 둘을
매기게 되어 CTC 정렬이 어긋난다. 실제 지문자에서도 겹받침은 두 번 쓰므로 풀어야
맞을 것 같지만, **확인하지 않았다.** 확인 전에는 라벨 표기를 그대로 둔다 —
지어내지 않는 쪽이 낫다.
"""

from __future__ import annotations

CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"
JUNG = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ"
JONG = [
    "", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ", "ㄻ", "ㄼ", "ㄽ",
    "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ",
    "ㅌ", "ㅍ", "ㅎ",
]

_BASE = 0xAC00
_LAST = 0xD7A3


def decompose(text: str) -> list[str]:
    """낱말 → 자모열. 한글이 아닌 글자(숫자·영문)는 그대로 한 칸을 차지한다.

    숫자는 지문자가 아니라 **지숫자**로 쓰지만, 라벨에서는 구분이 없다.
    분리하지 않고 그대로 둔다 — 어차피 손 모양 하나에 기호 하나로 대응한다.
    """
    out: list[str] = []
    for ch in text:
        code = ord(ch)
        if _BASE <= code <= _LAST:
            index = code - _BASE
            out.append(CHO[index // 588])
            out.append(JUNG[(index % 588) // 28])
            tail = JONG[index % 28]
            if tail:
                out.append(tail)
        elif ch.strip():
            out.append(ch)
    return out


def compose(jamos: list[str]) -> str:
    """자모열 → 낱말. CTC가 뱉은 자모열을 사람이 읽는 글자로 되돌린다.

    모델은 자모를 하나씩 내놓으므로 **초성-중성(-종성)으로 다시 묶어야** 한다.
    묶이지 않는 자모(예: 모음 없이 자음만 이어짐)는 버리지 않고 그대로 남긴다 —
    무엇이 어긋났는지 사람이 볼 수 있어야 고칠 수 있다.
    """
    out: list[str] = []
    i = 0
    n = len(jamos)
    while i < n:
        cho = jamos[i]
        if cho in CHO and i + 1 < n and jamos[i + 1] in JUNG:
            jung = jamos[i + 1]
            jong = ""
            # 다음 자모가 종성이 될 수 있고, **그 다음이 모음이 아닐 때만** 종성으로 붙인다.
            # (모음이 이어지면 그 자음은 다음 글자의 초성이다 — "가나"의 ㄴ)
            if i + 2 < n and jamos[i + 2] in JONG[1:]:
                if not (i + 3 < n and jamos[i + 3] in JUNG):
                    jong = jamos[i + 2]
            code = _BASE + (CHO.index(cho) * 588) + (JUNG.index(jung) * 28) + JONG.index(jong)
            out.append(chr(code))
            i += 2 + (1 if jong else 0)
        else:
            out.append(cho)
            i += 1
    return "".join(out)

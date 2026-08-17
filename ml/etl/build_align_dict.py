"""한국어 낱말 ↔ 글로스 대응 사전 만들기 (통계적 정렬).

    python -m ml.etl.build_align_dict --data <수어스크립트 out> --out public/data/align.json

**왜 필요한가.** KoBART(text2gloss)는 품질이 좋지만 500MB짜리 서버가 있어야 한다.
서버 없이 도는 정적 사이트에서도 임의 문장을 번역하려면 브라우저가 들고 다닐 수 있는
작은 사전이 필요하다. 현재 앱의 규칙 기반 `signAgent.ts`는 조사만 떼는 수준이라
"재난문자→수어"라고 부르기 어렵다. 이 사전은 **실제 16만 문장쌍에서 뽑은 대응**이다.

**어떻게 만드나.** 문장쌍 (한국어 원문, 글로스열)에서 공기(co-occurrence)를 세고
Dice 계수로 연관도를 잰다:

    dice(w, g) = 2·같이 나온 횟수 / (w 나온 횟수 + g 나온 횟수)

번역 모델처럼 어순까지 배우진 못하지만, "한파→춥다1", "대피→도망1" 같은 어휘 대응은
이 방식으로 충분히 잡힌다. 한국어는 교착어라 어미가 붙으므로 **어간 근사**로 맞춘다
(조사·어미를 떼고 2글자 이상 앞부분을 키로 삼는다).

출력은 `{"한파": ["춥다1", ...], ...}` 형태이며 낱말당 상위 후보 몇 개만 남긴다.
브라우저는 이 표를 훑어 문장을 글로스열로 바꾸고, 동작 사전에서 조각을 찾아 잇는다.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ml.signbridge.vocab import normalize_gloss  # noqa: E402

# 조사·어미. 한국어 형태소 분석기 없이 근사한다 — 사전 품질에 결정적이진 않다.
PARTICLE_RE = re.compile(
    r"(으로부터|로부터|에서는|에게서|께서는|하시기|하십시오|입니다|습니다|ㅂ니다"
    r"|하겠습니다|겠습니다|았습니다|었습니다|였습니다|습니까|ㅂ니까|을까요|ㄹ까요"
    r"|으십시오|십시오|으세요|세요|주세요|네요|지요|까요|어요|아요|여요|드리오니|되오니|하오니|오니"
    r"|으로|에서|에게|에는|까지|부터|이나|라도|처럼|만큼|보다|이며|이고|하고"
    r"|하는|하여|해서|되어|되는|된다|하라|하세요|해요|이다|이란|라는"
    r"|은|는|이|가|을|를|와|과|의|도|만|로|에|께|랑|나)$"
)
TOKEN_RE = re.compile(r"[가-힣]+")
MIN_STEM = 2

# 번역 제외어 — 한국어 문법·공손 표현으로, 수어에서는 표현하지 않는 말들.
# 실측 감사에서 이런 낱말의 Dice 매핑이 전부 잡음이었다(바랍니다→조심1,
# 주시기→자동차2, 있습니다→기차1, 시까지→노래1 …). 키를 만들지 않으면
# 잡음이 사전에 들어올 길 자체가 없다. **TS(dictSignAgent.ts)와 같은 목록 유지.**
STOP_WORDS = {
    "바랍니다", "바라며", "바람니다", "주시기", "주십시오", "있습니다", "있는",
    "있으니", "있으면", "없습니다", "않도록", "않기", "됩니다", "되도록",
    "합니다", "하시기", "하도록", "인해", "인한", "위해", "위한", "통해",
    "통하여", "따라", "따른", "대한", "대해", "관련", "관한", "해당",
    "등의", "등을", "등이", "및", "또는", "그리고", "기타", "위하여", "인하여",
    "시까지", "분부터", "시부터", "분까지", "실시",
    # 창구 대화 실측에서 새로 드러난 잡음 — 공손·의뢰 표현(주세요→매일1 같은 오역원)
    "주세요", "주시", "드릴까요", "드릴게요", "드립니다", "드려요", "하겠습니다",
    "하시겠어요", "하시겠습니까", "부탁드립니다", "말씀해", "말씀", "여쭤",
}

# 수동 시드 — 통계가 놓치는 고빈도 대응을 사람이 확정한 것. 자신 있는 것만 넣는다.
# (실측 감사에서 발견된 잡음 1위 후보를 교정: 곳으로→편하다1 등)
SEED_OVERRIDES = {
    "곳으로": "장소1",
    "곳에서": "장소1",
    "안전": "안전1",
    "안전한": "안전한1",
    "주민들": "주민0",
    "많은": "많다1",
    "여진": "지진1",
    # 금지("가지 마세요")는 수어에서 전용 표현이 있다. 통계는 '마세요'를 '마다'로 잡았다.
    "마세요": "하지마1",
    "마십시오": "하지마1",
    "말고": "하지마1",
    "금지": "하지마1",
}


# ── 용언 활용형 만들기 ────────────────────────────────────────────────
# **왜 빌드 시점에 하나.** 창구 대화 실측에서 빠진 낱말의 대부분이 활용형이었다
# (기다려·찍어·보여·뽑고·드세요·났나요…). 런타임 어간 추출기를 더 똑똑하게 만들 수도
# 있지만, 그러면 `dictSignAgent.ts`와 규칙을 **양쪽에서 똑같이** 유지해야 한다 —
# 이 프로젝트에서 가장 찾기 어려운 실패가 바로 그 비대칭이다. 활용형을 미리 펼쳐
# 사전 키로 넣으면 런타임은 그대로 두고도 찾을 수 있다.
#
# 어간 + 아/어 가 한 글자로 합쳐지는 것을 되돌리는 규칙(한글 조합 계산):
#   하 + 여 → 해 · 기다리 + 어 → 기다려 · 보 + 아 → 봐 · 주 + 어 → 줘
_CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"
_JUNG = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ"
# 어간 끝 모음 → 아/어가 붙어 합쳐진 모음
_FUSE = {"ㅣ": "ㅕ", "ㅗ": "ㅘ", "ㅜ": "ㅝ", "ㅚ": "ㅙ", "ㅏ": "ㅏ", "ㅓ": "ㅓ", "ㅐ": "ㅐ", "ㅔ": "ㅔ"}
# 양성모음이면 '아', 아니면 '어'가 붙는다(모음조화).
_BRIGHT = {"ㅏ", "ㅗ", "ㅑ", "ㅛ"}


def _decompose(ch: str) -> tuple[int, int, int] | None:
    code = ord(ch) - 0xAC00
    if not (0 <= code < 11172):
        return None
    return code // 588, (code % 588) // 28, code % 28


def _compose(cho: int, jung: int, jong: int) -> str:
    return chr(0xAC00 + cho * 588 + jung * 28 + jong)


def conjugations(stem_word: str) -> list[str]:
    """어간 하나에서 자주 쓰는 활용형을 만든다. 확실한 것만 — 과생성은 오역이 된다."""
    if len(stem_word) < 1:
        return []
    # 종결·연결 어미. 런타임 어간 추출기가 떼지 못하거나(나요·시나요),
    # 떼고 나면 한 글자만 남아 버려지는 것들(오세요 → '오')을 키로 직접 넣는다.
    forms = [
        stem_word + s
        for s in ("고", "지", "게", "며", "면", "니", "세요", "십시오", "시고",
                  "나요", "시나요", "셨", "시면", "는데", "지만", "려고",
                  "신지", "시는지", "실", "십니까", "시겠",
                  # 존대·추측·의향 — 창구에서 실제로 쓰이는 말투다(홀드아웃 실측에서
                  # "오셨나요·아프신가요·잡을까요"가 통째로 빠졌다).
                  "셨나요", "셨어요", "셨습니다", "셨는데", "신가요", "실까요", "십니다",
                  "겠어요", "겠는데", "시죠", "시네요")
    ]
    parts = _decompose(stem_word[-1])
    if parts is None:
        return forms
    cho, jung, jong = parts
    vowel = _JUNG[jung]
    harmonic: list[str] = []  # 아/어가 결합한 꼴 — 과거형의 뿌리가 된다
    if jong:
        # 받침이 있으면 합쳐지지 않고 그대로 붙는다: 찍 + 어 → 찍어
        harmony = "아" if vowel in _BRIGHT else "어"
        harmonic.append(stem_word + harmony)
        forms += [stem_word + harmony, stem_word + harmony + "요",
                  stem_word + harmony + "서", stem_word + harmony + "야",
                  stem_word + harmony + "집니다", stem_word + harmony + "졌"]
        forms += [stem_word + "은", stem_word + "습니다", stem_word + "습니까",
                  stem_word + "으면", stem_word + "으세요", stem_word + "으니",
                  stem_word + "을", stem_word + "을까요", stem_word + "을게요", stem_word + "으시면",
                  stem_word + "으셨", stem_word + "으신가요"]
    else:
        # 받침이 없으면 'ㅂ니다'가 받침으로 붙는다: 오 + ㅂ니다 → 옵니다
        head = stem_word[:-1]
        forms.append(head + _compose(cho, jung, 17) + "니다")  # 17 = 종성 ㅂ
        forms.append(head + _compose(cho, jung, 4) + "다")  # 4 = 종성 ㄴ (온다·간다)
        forms.append(head + _compose(cho, jung, 4))  # 관형형: 나온·온·간
        # 받침 없는 어간에는 'ㄹ'이 받침으로 붙는다: 되 + ㄹ까요 → 될까요
        forms.append(head + _compose(cho, jung, 8) + "까요")
        forms.append(head + _compose(cho, jung, 8) + "게요")
        forms.append(head + _compose(cho, jung, 8))  # 관형형: 갈·볼·나갈
        if vowel in ("ㅏ", "ㅓ", "ㅐ", "ㅔ"):
            # 같은 모음이 겹치면 하나로 줄어든다: 가 + 아 → 가 · 서 + 어 → 서
            harmonic.append(stem_word)
            forms += [stem_word, stem_word + "요", stem_word + "서"]
        elif vowel == "ㅡ" and len(stem_word) >= 2:
            # ㅡ 탈락 — 아프다 → 아파, 쓰다 → 써, 바쁘다 → 바빠.
            # 붙는 모음은 **앞 음절**의 모음이 정한다(아프 → 앞이 ㅏ라 '아' → 아파).
            prev = _decompose(stem_word[-2])
            bright = prev is not None and _JUNG[prev[1]] in _BRIGHT
            dropped = stem_word[:-1] + _compose(cho, _JUNG.index("ㅏ" if bright else "ㅓ"), 0)
            harmonic.append(dropped)
            forms += [dropped, dropped + "요", dropped + "서", dropped + "야"]
        elif vowel in _FUSE:
            fused = stem_word[:-1] + _compose(cho, _JUNG.index(_FUSE[vowel]), 0)
            harmonic.append(fused)
            forms += [fused, fused + "요", fused + "서", fused + "야"]
    # '하다' 용언은 '해'로 — 가장 흔한 불규칙이라 따로 둔다(공부하다 → 공부해)
    if stem_word.endswith("하"):
        forms.append(stem_word[:-1] + "해")
        harmonic.append(stem_word[:-1] + "해")
    # ㄹ 불규칙 — 받침 ㄹ은 ㄴ·ㅂ·ㅅ 앞에서 떨어진다: 들다 → 드세요·듭니다, 살다 → 사세요
    if parts is not None and jong == 8:  # 8 = 종성 ㄹ
        bare = stem_word[:-1] + _compose(cho, jung, 0)
        forms += [bare + "세요", bare + "십시오", bare + "니", bare + "시고",
                  bare[:-1] + _compose(cho, jung, 17) + "니다"]
    # ㅂ 불규칙 — 맵다 → 매운·매워, 춥다 → 추운·추워. 감각 형용사가 대부분 여기 속한다.
    if parts is not None and jong == 17:  # 17 = 종성 ㅂ
        bare = stem_word[:-1] + _compose(cho, jung, 0)
        forms += [bare + "운", bare + "워", bare + "워요", bare + "우면", bare + "웠"]
        harmonic.append(bare + "워")
    # 르 불규칙 — 누르다 → 눌러, 빠르다 → 빨라, 다르다 → 달라.
    if len(stem_word) >= 2 and stem_word.endswith("르"):
        prev = _decompose(stem_word[-2])
        if prev is not None and prev[2] == 0:
            head = stem_word[:-2] + _compose(prev[0], prev[1], 8)  # 앞 글자에 ㄹ 받침
            tail = "라" if _JUNG[prev[1]] in _BRIGHT else "러"
            forms += [head + tail, head + tail + "요", head + tail + "서"]
            harmonic.append(head + tail)

    # 과거형 — "왔어요·먹었습니다·기다렸어요". 창구 대화에 흔한데 통째로 빠져 있었다.
    # **아/어 결합형에서만** 만든다. 모든 활용형에 붙이면 "먹습니닸어요" 같은 것이 나온다.
    past: list[str] = []
    for f in harmonic:
        last = _decompose(f[-1])
        if last is None:
            continue
        if last[2] == 0:
            stem_past = f[:-1] + _compose(last[0], last[1], 20)  # 20 = 종성 ㅆ
        else:
            continue
        past += [stem_past + "어요", stem_past + "습니다", stem_past + "다", stem_past + "는데",
                 stem_past + "나요", stem_past + "습니까", stem_past + "어서", stem_past + "지만"]
    forms += past
    return forms


# 한 글자 명사에 붙는 조사 — 코와·입을·손과·문을·벽을·눈이 …
# **왜 따로 다루나.** 런타임 어간 추출기는 조사를 뗀 결과가 두 글자 미만이면 원형을
# 되돌린다(MIN_STEM). 그래서 **한 글자 명사는 조사가 붙는 순간 통째로 못 찾는다.**
# 하필 몸 부위와 생활 명사가 대부분 한 글자다 — 코·입·손·눈·목·배·발·귀·문·벽·물·약·
# 열·피·밥·길·돈. 행동요령 실측에서 "젖은 수건으로 코와 입을 가리세요"가 '수건' 하나만
# 표현된 것이 이 때문이었다. 조사가 붙은 꼴을 미리 키로 만들어 둔다.
# 받침 유무로 갈리는 조사는 짝지어 둔다(받침 있음, 받침 없음).
PARTICLE_PAIRS = (("은", "는"), ("이", "가"), ("을", "를"), ("과", "와"),
                  ("으로", "로"), ("이나", "나"), ("이랑", "랑"))
# 받침과 무관한 조사
PARTICLE_BOTH = ("의", "도", "만", "에", "에서", "에게", "부터", "까지", "보다", "처럼")

# 명사에서 파생되는 용언 꼴 — 침수된·대피하세요·통제한 …
NOUN_VERB_SUFFIXES = ("하다", "한", "할", "하는", "하고", "해", "하세요", "합니다",
                      "되다", "된", "될", "되는", "되고", "돼", "됐",
                      # 어간만 남는 꼴 — "확인되었습니다"는 어미를 떼면 '확인되'가 된다
                      # (런타임 어간 추출기가 '되었습니다'까지는 못 뗀다). 나머지 활용은
                      # 어간 추출기가 떼므로 여기서는 **어간 둘만** 넣는다 — 접미사를
                      # 늘릴수록 사전이 커지는데(8개 넣으니 4.7 → 6.4MB) 얻는 건 적었다.
                      "하", "되")


def noun_forms(lemma: str) -> list[str]:
    """명사 표제어에서 조사·파생형을 만든다."""
    out: list[str] = []
    # 한 글자 명사만 조사를 펼친다 — 두 글자 이상은 런타임 어간 추출기가 처리한다.
    if len(lemma) == 1:
        parts = _decompose(lemma)
        has_jong = parts is not None and parts[2] != 0
        out += [lemma + (a if has_jong else b) for a, b in PARTICLE_PAIRS]
        out += [lemma + p for p in PARTICLE_BOTH]
    out += [lemma + s for s in NOUN_VERB_SUFFIXES]
    return out


def stem(word: str) -> str:
    """조사·어미를 떼어 어간을 근사한다. 너무 짧아지면 원형을 남긴다."""
    prev = None
    out = word
    # 어미가 겹쳐 붙는 경우가 있어 더 줄어들지 않을 때까지 반복한다.
    while out != prev:
        prev = out
        stripped = PARTICLE_RE.sub("", out)
        if len(stripped) >= MIN_STEM:
            out = stripped
    return out if len(out) >= MIN_STEM else word


def tokenize(text: str) -> list[str]:
    return [
        stem(t) for t in TOKEN_RE.findall(text)
        if len(t) >= MIN_STEM and t not in STOP_WORDS and stem(t) not in STOP_WORDS
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description="한국어↔글로스 통계 사전")
    parser.add_argument("--data", type=Path, required=True, help="index.jsonl이 있는 디렉터리")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--top", type=int, default=3, help="낱말당 남길 글로스 후보 수")
    parser.add_argument("--min-pair", type=int, default=5, help="이보다 드문 공기는 버린다")
    parser.add_argument("--min-dice", type=float, default=0.06)
    parser.add_argument("--vocab", type=Path, default=None,
                        help="동작 사전 bank.json — 있으면 표현 가능한 글로스만 남긴다")
    args = parser.parse_args()

    playable: set[str] | None = None
    if args.vocab and args.vocab.exists():
        playable = set(json.loads(args.vocab.read_text(encoding="utf-8")).keys())
        # **주석 글로스는 번역 후보에서 뺀다.** 원본 말뭉치에는 "날짜:9월16일",
        # "시:15", "시간:2시간" 같은 클립이 있는데, 이건 낱말이 아니라 그 문장에만
        # 해당하는 숫자 주석이다. 공기 통계는 이걸 자주 1순위로 올려 놓았다 —
        # 실측에서 "주택→날짜:9월16일", "많음→날짜:12월13일", "민방위훈련→시간:15분"
        # 처럼 **낱말 2만 개**가 뜻과 무관한 날짜 동작을 가리키고 있었다.
        # 숫자·시각은 앱이 직접 읽어 표현하므로(numberGlosses) 여기서 뺀다.
        annotated = {g for g in playable if ":" in g}
        playable -= annotated
        print(f"[align] 동작 사전 {len(playable):,}종으로 후보를 제한합니다"
              f" (날짜·시각 주석 {len(annotated):,}종 제외)")

    word_count: Counter = Counter()
    gloss_count: Counter = Counter()
    pair_count: dict[str, Counter] = defaultdict(Counter)
    sentences = 0

    for line in open(args.data / "index.jsonl", encoding="utf-8"):
        record = json.loads(line)
        korean = record.get("korean_text") or ""
        glosses = {normalize_gloss(g.get("gloss", "")) for g in record.get("glosses", [])}
        glosses = {g for g in glosses if g and (playable is None or g in playable)}
        words = set(tokenize(korean))
        if not words or not glosses:
            continue
        sentences += 1
        for w in words:
            word_count[w] += 1
            for g in glosses:
                pair_count[w][g] += 1
        for g in glosses:
            gloss_count[g] += 1
        if sentences % 20000 == 0:
            print(f"  [align] 문장 {sentences:,}개 처리", flush=True)

    print(f"[align] 문장 {sentences:,} · 낱말 {len(word_count):,} · 글로스 {len(gloss_count):,}")

    # 글로스 ID는 "조심1"처럼 한국어 표제어+번호다. 표제어가 낱말과 정확히 같으면
    # 그 자체가 가장 믿을 만한 번역이다 — Dice가 잡음으로 엉뚱한 후보를 1위에 올려도
    # (실례: 조심→비닐하우스0) 표제어 일치가 있으면 그걸 앞세운다.
    lemma_re = re.compile(r"[0-9#:]+$")
    lemma_best: dict[str, str] = {}
    for g in (playable if playable is not None else gloss_count):
        lemma = lemma_re.sub("", g)
        # **한 글자 표제어도 담는다.** 예전 조건(>= MIN_STEM)이 약·열·코·입·손·목·문·벽을
        # 통째로 걸러, 조사가 붙은 꼴(약이·열이·코와)을 만들 기회조차 없었다.
        if len(lemma) >= 1:
            # 번호가 작은 변이형(기본형)을 남긴다: 조심1 > 조심2
            if lemma not in lemma_best or g < lemma_best[lemma]:
                lemma_best[lemma] = g

    table: dict[str, list[str]] = {}
    for word, counts in pair_count.items():
        if word_count[word] < args.min_pair:
            continue
        scored = []
        for gloss, both in counts.items():
            if both < args.min_pair:
                continue
            dice = 2 * both / (word_count[word] + gloss_count[gloss])
            if dice < args.min_dice:
                continue
            scored.append((dice, gloss))
        if not scored:
            continue
        scored.sort(reverse=True)
        cands = [g for _, g in scored[: args.top]]
        # 용언 표제어는 "-다"형(기다리다1)이라 어간("기다리")과 어긋난다 — 둘 다 본다.
        exact = lemma_best.get(word) or lemma_best.get(word + "다")
        if not exact and word.endswith("기"):
            exact = lemma_best.get(word[:-1] + "다")  # 마시기 → 마시다
        if exact:
            cands = [exact] + [g for g in cands if g != exact]
        table[word] = cands[: args.top]

    # 공기 통계에 안 잡혔더라도 표제어가 곧 낱말인 글로스는 사전에 넣는다 —
    # 지명·희귀어 커버리지가 공짜로 늘어난다.
    added = 0
    for lemma, g in lemma_best.items():
        # 한 글자 표제어는 직결 키로 넣지 않는다 — 런타임이 조회하지 않을뿐더러,
        # 지문자 자모 글로스가 섞여 있어 넣으면 오역이 된다.
        if len(lemma) < MIN_STEM:
            continue
        if lemma not in table:
            table[lemma] = [g]
            added += 1
        # 용언은 어간형 키도 함께 — "기다리다1"을 "기다리"(어간)로도 찾게 한다.
        if lemma.endswith("다") and len(lemma) >= 3 and lemma[:-1] not in table:
            table[lemma[:-1]] = [g]
            added += 1
    print(f"[align] 표제어 직결 추가 {added:,}개 (Dice 미포착분)")

    # 용언 활용형 — 창구 대화에서 빠진 낱말의 대부분이 이것이었다(기다려·찍어·뽑고…).
    # 이미 있는 키는 건드리지 않는다(Dice가 실제로 관측한 대응이 우선).
    conj = 0
    noun = 0
    # 형태론으로 만들어 낸 키는 뒤의 복합어 프루닝에서 빼야 한다. 안 그러면 "아프신지"가
    # "아프 + 신지(신다)"로 분해된다고 보고 지워져, 실제 번역이 '아프다 신다'가 된다.
    derived: set[str] = set()
    # **빈도가 높은 표제어가 먼저 가져간다.** 같은 표면형을 두 낱말이 만들 수 있기 때문이다
    # (아프시+ㄴ지 = 아프신지, 신+지 = 신지). 흔한 쪽이 맞을 확률이 높다.
    ordered = sorted(lemma_best.items(), key=lambda kv: -gloss_count.get(kv[1], 0))
    for lemma, g in ordered:
        if lemma.endswith("다") and len(lemma) >= 2:
            # 어간이 한 글자여도 만든다(있다·하다·가다·오다·보다·먹다 — 가장 흔한 용언들).
            # 예전 조건 len(lemma) < 3 이 이들을 통째로 걸러 "있나요·오세요"가 없었다.
            for form in conjugations(lemma[:-1]):
                if len(form) >= MIN_STEM and form not in table and form not in STOP_WORDS:
                    table[form] = [g]
                    derived.add(form)
                    conj += 1
            continue
        # 명사: 한 글자 명사의 조사형은 **Dice를 덮는다.** "물을→끓다1"처럼, 표제어가
        # 분명한데 공기 통계가 엉뚱한 낱말을 1위에 올려놓은 경우가 실제로 있었다.
        # 표제어+조사는 사람이 봐도 확실한 대응이라 통계보다 앞세우는 편이 옳다.
        for form in noun_forms(lemma):
            if len(form) < MIN_STEM or form in STOP_WORDS:
                continue
            if form in table:
                # 표제어 + 조사/파생접미사는 사람이 봐도 확실한 대응이라 통계보다 앞세운다.
                # (실측: "안전한→편하다1", "물을→끓다1" — 둘 다 공기 통계의 잡음이었다)
                if table[form][0] == g:
                    continue
                table[form] = [g] + [x for x in table[form] if x != g][: args.top - 1]
            else:
                table[form] = [g]
            derived.add(form)
            noun += 1
    print(f"[align] 용언 활용형 추가 {conj:,}개 · 명사 조사/파생형 추가 {noun:,}개")

    # 복합어 통짜 키 제거 — "대피바랍니다"·"안전사고"처럼 두 낱말 이상으로 분해되는
    # 키는 지운다. 통짜 키의 Dice 매핑은 잡음이기 쉽고(실측: 대피바랍니다→낚시1,
    # 민방위훈련→시간:15분), 키가 없으면 브라우저가 최장일치 분해로 각 조각을
    # 정확히 번역한다. 표제어 직결 키(그 자체가 사전 표제어)는 지우지 않는다.
    def decomposes(word: str) -> bool:
        """낱말 전체가 사전 조각으로 덮이는가 — 브라우저의 분해와 **같은 판정**이어야 한다.

        런타임(dictSignAgent.ts)은 낱말 전체를 덮는 분해를 찾는다. 여기서 탐욕적으로
        판정하면 "런타임은 분해할 수 있는데 빌더는 못 한다"가 되어, 지워도 될 잡음 키가
        남거나 남겨야 할 키가 지워진다. 그래서 여기도 전체 덮기로 본다.
        """
        n = len(word)
        reachable = [False] * (n + 1)
        reachable[n] = True
        for i in range(n - 1, -1, -1):
            for length in range(min(n - i, 6), MIN_STEM - 1, -1):
                if not reachable[i + length]:
                    continue
                piece = word[i : i + length]
                if piece != word and (piece in table or piece in STOP_WORDS):
                    reachable[i] = True
                    break
        if not reachable[0]:
            return False
        # 조각이 둘 이상이어야 분해로 친다(한 조각 = 자기 자신은 분해가 아니다).
        return any(
            reachable[length] and word[:length] != word
            for length in range(MIN_STEM, min(n, 6) + 1)
        )

    pruned = 0
    for word in list(table):
        if len(word) >= 4 and word not in lemma_best and word not in derived and decomposes(word):
            del table[word]
            pruned += 1
    print(f"[align] 분해 가능한 복합 키 {pruned:,}개 제거 (조각 번역 우선)")

    # 수동 시드는 마지막에 강제 — 통계·프루닝 결과와 무관하게 1순위를 보장한다.
    seeded = 0
    for word, g in SEED_OVERRIDES.items():
        if playable is not None and g not in playable:
            print(f"[align] ⚠️ 시드 {word}→{g} 는 동작 사전에 없어 건너뜀")
            continue
        prev = [x for x in table.get(word, []) if x != g]
        table[word] = [g] + prev[: args.top - 1]
        seeded += 1
    print(f"[align] 수동 시드 {seeded}개 적용")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(table, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    size = args.out.stat().st_size / 1024
    print(f"[align] 낱말 {len(table):,}개 → {args.out} ({size:.0f}KB)")

    demo = ["한파", "대피", "지진", "호우", "산불", "주의", "태풍", "마스크", "대설", "화재"]
    print("[align] 표본:")
    for w in demo:
        if w in table:
            print(f"   {w:<6} → {' / '.join(table[w])}")


if __name__ == "__main__":
    main()

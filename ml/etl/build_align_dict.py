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
                  "나요", "시나요", "셨", "시면", "는데", "지만", "려고")
    ]
    parts = _decompose(stem_word[-1])
    if parts is None:
        return forms
    cho, jung, jong = parts
    vowel = _JUNG[jung]
    if jong:
        # 받침이 있으면 합쳐지지 않고 그대로 붙는다: 찍 + 어 → 찍어
        harmony = "아" if vowel in _BRIGHT else "어"
        forms += [stem_word + harmony, stem_word + harmony + "요",
                  stem_word + harmony + "서", stem_word + harmony + "야",
                  stem_word + harmony + "집니다", stem_word + harmony + "졌"]
        forms += [stem_word + "은", stem_word + "습니다", stem_word + "습니까",
                  stem_word + "으면", stem_word + "으세요", stem_word + "으니"]
    else:
        # 받침이 없으면 'ㅂ니다'가 받침으로 붙는다: 오 + ㅂ니다 → 옵니다
        head = stem_word[:-1]
        forms.append(head + _compose(cho, jung, 17) + "니다")  # 17 = 종성 ㅂ
        forms.append(head + _compose(cho, jung, 4) + "다")  # 4 = 종성 ㄴ (온·간)
        if vowel in ("ㅏ", "ㅓ", "ㅐ", "ㅔ"):
            # 같은 모음이 겹치면 하나로 줄어든다: 가 + 아 → 가 · 서 + 어 → 서
            forms += [stem_word, stem_word + "요", stem_word + "서"]
        elif vowel in _FUSE:
            fused = stem_word[:-1] + _compose(cho, _JUNG.index(_FUSE[vowel]), 0)
            forms += [fused, fused + "요", fused + "서", fused + "야"]
    # '하다' 용언은 '해'로 — 가장 흔한 불규칙이라 따로 둔다(공부하다 → 공부해)
    if stem_word.endswith("하"):
        forms.append(stem_word[:-1] + "해")
    # ㄹ 불규칙 — 받침 ㄹ은 ㄴ·ㅂ·ㅅ 앞에서 떨어진다: 들다 → 드세요·듭니다, 살다 → 사세요
    if parts is not None and jong == 8:  # 8 = 종성 ㄹ
        bare = stem_word[:-1] + _compose(cho, jung, 0)
        forms += [bare + "세요", bare + "십시오", bare + "니", bare + "시고",
                  bare[:-1] + _compose(cho, jung, 17) + "니다"]
    return forms


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
        print(f"[align] 동작 사전 {len(playable):,}종으로 후보를 제한합니다")

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
        if len(lemma) >= MIN_STEM:
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
    for lemma, g in list(lemma_best.items()):
        # 어간이 한 글자여도 만든다(있다·하다·가다·오다·보다·먹다 — 가장 흔한 용언들이다).
        # 예전 조건 len(lemma) < 3 이 이들을 통째로 걸러 "있나요·오세요"가 사전에 없었다.
        if not lemma.endswith("다") or len(lemma) < 2:
            continue
        for form in conjugations(lemma[:-1]):
            if len(form) >= MIN_STEM and form not in table and form not in STOP_WORDS:
                table[form] = [g]
                conj += 1
    print(f"[align] 용언 활용형 추가 {conj:,}개")

    # 복합어 통짜 키 제거 — "대피바랍니다"·"안전사고"처럼 두 낱말 이상으로 분해되는
    # 키는 지운다. 통짜 키의 Dice 매핑은 잡음이기 쉽고(실측: 대피바랍니다→낚시1,
    # 민방위훈련→시간:15분), 키가 없으면 브라우저가 최장일치 분해로 각 조각을
    # 정확히 번역한다. 표제어 직결 키(그 자체가 사전 표제어)는 지우지 않는다.
    def decomposes(word: str) -> bool:
        parts = 0
        i = 0
        while i < len(word):
            matched = 0
            for length in range(min(len(word) - i, 6), MIN_STEM - 1, -1):
                piece = word[i : i + length]
                if piece != word and (piece in table or piece in STOP_WORDS):
                    matched = length
                    break
            if not matched:
                return False  # 전체가 조각으로 덮이지 않으면 통짜 키를 유지
            parts += 1
            i += matched
        return parts >= 2

    pruned = 0
    for word in list(table):
        if len(word) >= 4 and word not in lemma_best and decomposes(word):
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

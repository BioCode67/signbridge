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
    r"|으십시오|십시오|으세요|세요|주세요|네요|지요|까요|어요|아요|여요"
    r"|으로|에서|에게|에는|까지|부터|이나|라도|처럼|만큼|보다|이며|이고|하고"
    r"|하는|하여|해서|되어|되는|된다|하라|하세요|해요|이다|이란|라는"
    r"|은|는|이|가|을|를|와|과|의|도|만|로|에|께|랑|나)$"
)
TOKEN_RE = re.compile(r"[가-힣]+")
MIN_STEM = 2


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
    return [stem(t) for t in TOKEN_RE.findall(text) if len(t) >= MIN_STEM]


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

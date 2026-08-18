#!/usr/bin/env python3
"""번역 사전에서 **수상한 대응**을 뽑아 사람이 검토하게 한다.

    python3 ml/tools/suspect_align.py --top 60

**왜 필요한가.** 낱말 표현률은 "몇 %가 수어로 나갔나"만 잰다. 맞게 나갔는지는
재지 않는다. 실측에서 `북동쪽 → km 지진 크기`, `크게 → 차이`, `같은 → 동광우방`
같은 대응이 표현률 95.8% 안에 그대로 들어 있었다. **잘못된 수어는 표현되지 않은
것보다 나쁘다** — 농인은 그것을 믿기 때문이다.

전수 검토는 175,843개라 불가능하다. 그래서 **의심할 이유가 있는 것만** 좁힌다:

  · 낱말과 글로스 표제어가 **글자를 하나도 공유하지 않는다**
    (한국어 낱말과 그 수어 글로스는 대개 같은 낱말이거나 어간을 공유한다)
  · 그런데도 그 낱말이 말뭉치에 **자주 나온다**(자주 틀리면 자주 아프다)
  · 낱말이 사전의 다른 조각으로 **분해되지도 않는다**(분해되면 조각 번역이 맞는다)

여기 걸린 것이 전부 오역은 아니다 — 한국어와 수어가 다른 낱말을 쓰는 자리도 많다
(대피 → 도망, 한파 → 춥다). 그래서 자동으로 지우지 않고 **목록만** 낸다.
사람이 보고 진짜 오역이면 SEED_OVERRIDES에 넣거나 규칙을 고친다.
"""
from __future__ import annotations

import argparse
import collections
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LEMMA_RE = re.compile(r"[0-9#:@]+$")
HANGUL = re.compile(r"[가-힣]+")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--align", type=Path, default=ROOT / "public/data/align.json")
    ap.add_argument("--corpus", type=Path, default=Path.home() / "sbdata/script/index.jsonl")
    ap.add_argument("--top", type=int, default=60, help="보여줄 개수")
    ap.add_argument("--min-count", type=int, default=5, help="말뭉치 최소 출현")
    a = ap.parse_args()

    table = json.loads(a.align.read_text(encoding="utf-8"))

    # 말뭉치 빈도 — 자주 쓰이는 낱말의 오역이 더 아프다.
    #
    # 함께 **비율**도 센다: 그 낱말이 나온 문장 중 몇 %에서 1순위 글로스가 같이
    # 나왔나. 이 값이 맞는 짝과 틀린 짝을 잘 가른다(실측, 2026-08-18).
    #
    #   급류 → 도청   28문장 중 6번(21%)   ← 우연히 스친 것
    #   폭염 → 덥다1  143문장 중 124번(87%) ← 진짜
    #
    # **낮다고 틀린 것은 아니다.** 이 비율만 보고 고치기 시작하면 오히려 나빠진다.
    # 날씨·재난 문장에는 배경처럼 깔리는 글로스가 있다(심하다1·지도1·조심1·전국1이
    # 문장 절반에 나온다). Dice는 글로스 쪽 빈도로 나누기 때문에 그런 배경을 이미
    # 걸러 내고 더 구체적인 글로스를 고른다 — 그래서 **맞는 대응인데 비율이 낮은**
    # 자리가 생긴다(실측: `한때`는 심하다1 44%·지도1 40%가 위에 있지만 뜻은 `가끔`).
    #
    # 그래서 문턱으로 자동으로 자르지 않는다. 잘라 보니 표현률이 96.1 → 93.7%로
    # 떨어지는데, 잘린 것 중 얼마가 진짜 오역인지는 못 잰다.
    # 이 숫자는 **판단 재료 하나**일 뿐이다. 낮으면서 뜻이 안 닿는 것을 찾는 데 쓴다
    # (급류 → 도청 21%처럼).
    count: collections.Counter[str] = collections.Counter()
    cooc: dict[str, collections.Counter[str]] = collections.defaultdict(collections.Counter)
    if a.corpus.exists():
        with a.corpus.open(encoding="utf-8") as fh:
            for line in fh:
                try:
                    o = json.loads(line)
                except json.JSONDecodeError:
                    continue
                text = o.get("korean_text") or o.get("text") or ""
                words = set(HANGUL.findall(text))
                count.update(words)
                glosses = {
                    str(g.get("gloss", "")).strip() for g in o.get("glosses", [])
                }
                glosses.discard("")
                if not glosses:
                    continue
                for w in words:
                    cooc[w].update(glosses)

    def ratio(word: str, gloss: str) -> float:
        """그 낱말이 나온 문장 중 이 글로스가 같이 나온 비율."""
        n = count.get(word, 0)
        if not n:
            return -1.0
        # 이형 번호까지 정확히 맞는 것만 센다 — 대응은 그 번호로 재생된다.
        return cooc[word].get(gloss, 0) / n

    keys = set(table)

    def decomposes(word: str) -> bool:
        """낱말이 사전의 다른 조각들로 전부 덮이는가(브라우저의 최장일치 분해)."""
        n = len(word)
        ok = [False] * (n + 1)
        ok[0] = True
        for i in range(1, n + 1):
            for j in range(max(0, i - 6), i):
                if ok[j] and i - j >= 2 and word[j:i] in keys and word[j:i] != word:
                    ok[i] = True
                    break
        return ok[n]

    suspects: list[tuple[int, str, str, list[str]]] = []
    for word, cands in table.items():
        if not cands:
            continue
        c = count.get(word, 0)
        if c < a.min_count:
            continue
        lemma = LEMMA_RE.sub("", cands[0])
        if not lemma:
            continue
        # 글자를 하나라도 공유하면 대개 같은 낱말이다(높은/높다, 대피/대피)
        if set(word) & set(lemma):
            continue
        if decomposes(word):
            continue
        suspects.append((c, word, cands[0], cands[1:3]))

    suspects.sort(reverse=True)
    print(f"[suspect] 사전 {len(table):,}개 중 검토 대상 {len(suspects):,}개 "
          f"(말뭉치 {a.min_count}회 이상 · 글자 공유 없음 · 분해 불가)")
    print(f"[suspect] 빈도 상위 {min(a.top, len(suspects))}개 — 사람이 보고 판단할 것")
    print("[suspect] '비율' = 그 낱말이 나온 문장 중 이 글로스가 같이 나온 비율.")
    print("          낮다고 틀린 것이 아니다 — 배경처럼 깔리는 흔한 글로스를")
    print("          Dice가 이미 걸러 낸 결과일 수 있다. 뜻이 안 닿는지를 함께 볼 것.\n")
    print(f"  {'빈도':>6} {'비율':>5}  {'낱말':<12} {'1순위':<14} 다음 후보")
    for c, word, g, alts in suspects[: a.top]:
        r = ratio(word, g)
        mark = f"{100 * r:4.0f}%" if r >= 0 else "   ?"
        print(f"  {c:>6} {mark}  {word:<12} {g:<14} {', '.join(alts)}")
    print("\n  진짜 오역이면 ml/etl/build_align_dict.py 의 SEED_OVERRIDES 에 넣고")
    print("  bash ml/jobs/rebuild_data.sh 를 다시 돌린다.")


if __name__ == "__main__":
    main()

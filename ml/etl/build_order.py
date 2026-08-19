"""수어 어순 편향표 만들기 — 낱말이 문장의 어디쯤 오는지 말뭉치에서 잰다.

    python -m ml.etl.build_order --data ~/sbdata/script --out public/data/order.json

**왜 필요한가.** 사전 기반 번역은 **한국어 어순 그대로** 글로스를 늘어놓는다. 그런데
한국수어는 어순이 다르다. 실측(재난 문장 6만 개)에서 편향이 뚜렷했다:

    문장 앞  경기1 0.17 · 강원1 0.18 · 제주1 0.18 · 오전1 0.15   (어디·언제를 먼저)
    문장 끝  조심1 0.84 · 부탁1 0.87 · 도망1 0.84 · 대비1 0.94   (당부·행동은 마지막)

즉 **[언제·어디] → [무슨 일] → [무엇을 하라]** 가 이 말뭉치의 어순이다. 규칙을 사람이
짜 넣는 대신, 농인 수어자들이 실제로 표현한 순서를 그대로 재어 쓴다.

내보내는 것은 `{"조심1": 0.84, ...}` 형태의 작은 표다. 브라우저는 번역 결과를 이 값으로
**안정 정렬**한다 — 편향이 없는 낱말은 원래 순서를 지킨다.

주의: 편향이 약한 낱말까지 옮기면 뜻이 흐트러진다. 충분히 자주 나오고(기본 300회)
가운데에서 충분히 떨어진(기본 0.15) 것만 싣는다.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ml.signbridge.vocab import normalize_gloss  # noqa: E402

# 글로스 ID에서 번호를 뗀 표제어. **표제어로 모은다** — 번역기는 '조심'을 내놓는데
# 말뭉치에는 '조심1'로 적혀 있어, ID로 맞추면 표가 있으나 마나 하다(실측에서 겪었다).
# 변이형(조심1·조심2)은 어순 성질이 같으므로 합치는 편이 자료도 두꺼워진다.
LEMMA_RE = re.compile(r"[0-9#:]+$")


def main() -> None:
    ap = argparse.ArgumentParser(description="수어 어순 편향표")
    ap.add_argument("--data", type=Path, required=True, help="index.jsonl이 있는 디렉터리")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--min-count", type=int, default=300, help="이보다 드물면 싣지 않는다")
    ap.add_argument("--min-bias", type=float, default=0.15,
                    help="가운데(0.5)에서 이만큼 떨어져야 싣는다")
    ap.add_argument("--vocab", type=Path, default=None,
                    help="동작 사전 bank.json — 있으면 표현 가능한 글로스만 남긴다")
    args = ap.parse_args()

    playable = None
    if args.vocab and args.vocab.exists():
        playable = {LEMMA_RE.sub("", g)
                    for g in json.loads(args.vocab.read_text(encoding="utf-8"))}

    spots: dict[str, list[float]] = defaultdict(list)
    sentences = 0
    for line in open(args.data / "index.jsonl", encoding="utf-8"):
        record = json.loads(line)
        glosses = [normalize_gloss(g.get("gloss", "")) for g in record.get("glosses", [])]
        glosses = [g for g in glosses if g]
        # 두 낱말짜리 문장은 어순 정보가 사실상 없다.
        if len(glosses) < 3:
            continue
        sentences += 1
        last = len(glosses) - 1
        for i, g in enumerate(glosses):
            spots[LEMMA_RE.sub("", g)].append(i / last)

    table: dict[str, float] = {}
    for gloss, values in spots.items():
        if len(values) < args.min_count:
            continue
        if playable is not None and gloss not in playable:
            continue
        mean = sum(values) / len(values)
        if abs(mean - 0.5) < args.min_bias:
            continue
        table[gloss] = round(mean, 3)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(table, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    early = sorted(table.items(), key=lambda kv: kv[1])[:8]
    late = sorted(table.items(), key=lambda kv: -kv[1])[:8]
    print(f"[order] 문장 {sentences:,}개 · 편향이 뚜렷한 글로스 {len(table):,}종 → {args.out}")
    print("  앞:", " · ".join(f"{g}({v})" for g, v in early))
    print("  뒤:", " · ".join(f"{g}({v})" for g, v in late))


if __name__ == "__main__":
    main()

"""실시간 관제 화면에 흘릴 **실제 재난문자 피드**를 뽑는다.

    python -m ml.etl.export_feed --data <수어스크립트 out> --out public/data/feed.json

데모가 "문장 17개를 눌러 재생하는 플레이어"로 보이면 곤란하다. 실제 재난문자가
계속 들어오고 그때그때 번역돼 송출되는 모습이어야 한다. 그 화면에 흘릴 문장을
**AI Hub 실데이터에서** 뽑는다(지어낸 문장이 아니라는 점이 중요하다).

고르는 기준
  - 재난 유형별로 고르게(한 유형이 화면을 독점하면 시연이 단조롭다)
  - 너무 길거나 짧은 문장 제외 — 관제 화면 한 줄에 들어가고 수어도 몇 초 안에 끝나야 한다
  - 앞부분이 같은 문장은 하나만(같은 공지의 지역만 바뀐 변형이 많다)
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

MIN_LEN, MAX_LEN = 20, 75
# 파일명에서 재난 유형을 얻는다: NIA_SL_G1_COLDWAVE000010_1_TW07
CATEGORY_RE = re.compile(r"NIA_SL_G\d+_([A-Z]+)\d+")


def main() -> None:
    parser = argparse.ArgumentParser(description="관제 화면용 재난문자 피드 추출")
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--per-category", type=int, default=6)
    args = parser.parse_args()

    by_category: dict[str, list[str]] = defaultdict(list)
    seen_prefix: set[str] = set()

    for line in open(args.data / "index.jsonl", encoding="utf-8"):
        record = json.loads(line)
        text = (record.get("korean_text") or "").strip()
        if not (MIN_LEN <= len(text) <= MAX_LEN):
            continue
        match = CATEGORY_RE.match(record.get("id", ""))
        category = match.group(1) if match else record.get("category") or "ETC"
        # 같은 공지의 지역만 바뀐 변형을 거른다.
        prefix = text[:14]
        if prefix in seen_prefix:
            continue
        if len(by_category[category]) >= args.per_category:
            continue
        seen_prefix.add(prefix)
        by_category[category].append(text)

    # 유형이 번갈아 나오도록 섞는다 — 한 유형이 연달아 나오면 시연이 단조롭다.
    feed: list[dict] = []
    round_index = 0
    while True:
        added = False
        for category in sorted(by_category):
            items = by_category[category]
            if round_index < len(items):
                feed.append({"category": category, "text": items[round_index]})
                added = True
        if not added:
            break
        round_index += 1

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(feed, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    print(f"[feed] 재난 유형 {len(by_category)}종 · 문장 {len(feed)}개 → {args.out}")
    print(f"[feed] 크기 {args.out.stat().st_size / 1024:.0f}KB")
    for item in feed[:5]:
        print(f"   [{item['category']}] {item['text'][:52]}…")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""동작 사전의 파일명에서 **윈도우가 못 쓰는 문자**를 없앤다.

    python3 ml/tools/fix_gloss_filenames.py            # 확인만
    python3 ml/tools/fix_gloss_filenames.py --apply    # 실제로 바꾸기

**왜 필요한가.** `safe_name`이 `:`를 일부러 남기고 있었다(`날짜:10월10일.json`).
웹에서는 아무 문제가 없어 오래 못 봤는데, **윈도우는 파일명에 `:`를 못 쓴다.**
노트북용 zip을 풀면 1,365개에서 이렇게 멈춘다:

    오류 0x80070057: 매개 변수가 틀립니다.
    시:8시26분.json

건너뛰면 압축은 풀리지만 **날짜·시각 수어가 통째로 빠진다.** 재난문자에 가장
자주 나오는 것들이고, 빠져도 오류가 안 난다 — 아바타가 조용히 설 뿐이다.

앱은 `bank.json`의 `file` 값을 그대로 fetch하므로, 파일과 bank를 함께 바꾸면
다른 코드는 손댈 것이 없다.
"""
from __future__ import annotations

import argparse
import json
import re
import unicodedata
from pathlib import Path

# 윈도우 금지: \ / : * ? " < > |   ·  `#`은 URL 조각 구분자
BAD = re.compile(r'[\\/:*?"<>|#]')


def safe_name(gloss: str) -> str:
    return re.sub(r"[^\w가-힣]+", "_", unicodedata.normalize("NFC", gloss))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", type=Path, default=Path("public/data"))
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()

    bank_path = a.root / "bank.json"
    gdir = a.root / "glosses"
    bank = json.loads(bank_path.read_text(encoding="utf-8"))

    plan: list[tuple[str, str, str]] = []  # gloss, 옛 파일, 새 파일
    for g, v in bank.items():
        f = v.get("file", "")
        if f and BAD.search(f):
            plan.append((g, f, safe_name(g) + ".json"))

    if not plan:
        print("[파일명] ✓ 윈도우에서 못 쓰는 이름이 없습니다")
        return 0

    # 충돌 검사 — 바꾼 이름이 겹치면 동작이 덮어써진다
    keep = {v["file"] for g, v in bank.items() if not BAD.search(v.get("file", ""))}
    seen: set[str] = set()
    clash = [n for _, _, n in plan if n in keep or (n in seen or seen.add(n))]
    if clash:
        print(f"[파일명] ✗ 이름 충돌 {len(clash)}건 — 손대지 않습니다: {clash[:5]}")
        return 1

    print(f"[파일명] 바꿀 것 {len(plan):,}개 (보기 3개)")
    for g, o, n in plan[:3]:
        print(f"    {o}  →  {n}")
    if not a.apply:
        print("[파일명] 확인만 했습니다. 실제로 바꾸려면 --apply")
        return 0

    moved = missing = 0
    for g, old, new in plan:
        src, dst = gdir / old, gdir / new
        if src.exists():
            src.rename(dst)
            moved += 1
        elif not dst.exists():
            missing += 1
        bank[g]["file"] = new

    bank_path.write_text(json.dumps(bank, ensure_ascii=False), encoding="utf-8")
    print(f"[파일명] ✓ 파일 {moved:,}개 옮기고 bank.json {len(plan):,}건 고쳤습니다"
          + (f" · 원본 없음 {missing}개" if missing else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

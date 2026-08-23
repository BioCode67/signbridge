#!/usr/bin/env python3
"""손으로 고친 번역이 **배포되는 사전에 실제로 들어 있는지** 잰다.

    python3 ml/tools/check_align_fixes.py

**왜 필요한가** (2026-08-23 실측). 앞선 세션들이 창구·병원 오역 417건을
고쳤는데, 고친 결과가 `public/data/align.json`에만 들어가고 그것을 만드는
`build_align_dict.py`에는 안 들어가 있었다. 그래서 사전을 다시 만드는
순간 417건이 **조용히 되돌아갔다** — 오류도 경고도 없고, 낱말은 그대로
다 나가므로 표현률로도 안 잡힌다. 회귀 사례 240건 중 59건이 한꺼번에
깨지고 나서야 알았다.

`features.py` ↔ `landmarks.ts`와 같은 부류의 어긋남이다. 그쪽은 숫자를
대조하고, 이쪽은 **고친 것이 살아 있는지**를 대조한다.

회귀 사례(`scripts/translation_cases.json`)는 문장 240개를 지키지만,
손질은 417건이다. 사례가 없는 자리는 이 검사가 지킨다.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ALIGN = ROOT / "public/data/align.json"
FIXES = ROOT / "ml/data/align_fixes.tsv"
BUILDER = ROOT / "ml/etl/build_align_dict.py"
BANK = ROOT / "public/data/bank.json"


def read_seeds() -> dict[str, str]:
    text = BUILDER.read_text(encoding="utf-8")
    m = re.search(r"SEED_OVERRIDES = \{(.*?)\n\}", text, re.S)
    if not m:
        return {}
    body = "\n".join(
        ln for ln in m.group(1).splitlines() if not ln.strip().startswith("#")
    )
    return dict(re.findall(r'"([^"]+)":\s*"([^"]+)"', body))


def read_fixes() -> dict[str, str]:
    out: dict[str, str] = {}
    if not FIXES.exists():
        return out
    for line in FIXES.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        word, _, gloss = line.partition("\t")
        if gloss:
            out[word] = gloss
    return out


def main() -> int:
    align = json.loads(ALIGN.read_text(encoding="utf-8"))
    bank = set(json.loads(BANK.read_text(encoding="utf-8")))
    seeds, fixes = read_seeds(), read_fixes()
    # 회수한 손질이 시드를 이긴다(빌더와 같은 순서).
    want = {**seeds, **fixes}

    print(f"[손질] 시드 {len(seeds)}개 · 회수한 손질 {len(fixes)}개 → 겹쳐서 {len(want)}개")

    missing_clip, wrong, gone = [], [], []
    for word, gloss in want.items():
        if gloss == "-":
            # 뺐어야 하는 키 — 남아 있으면 복합어 분해를 가로막는다.
            if word in align:
                gone.append((word, align[word][:1]))
            continue
        if gloss not in bank:
            # 동작 사전에 클립이 없으면 빌더가 건너뛴다(경고를 냈을 것이다).
            missing_clip.append((word, gloss))
            continue
        got = align.get(word, [])[:1]
        if got != [gloss]:
            wrong.append((word, gloss, got[0] if got else "(없음)"))

    for word, gloss in missing_clip:
        print(f"  · {word} → {gloss} 는 동작 사전에 클립이 없어 건너뜁니다")

    if gone:
        print(f"\n  ✗ 뺐어야 하는 키가 사전에 남아 있습니다 ({len(gone)}개)")
        for word, got in gone[:20]:
            print(f"      {word} → {got}  ← 이것이 복합어 분해를 가로막습니다")
    if wrong:
        print(f"\n  ✗ 고친 번역이 사전에 없습니다 ({len(wrong)}개)")
        for word, gloss, got in wrong[:20]:
            print(f"      {word}: {gloss} 이어야 하는데 {got}")
        if len(wrong) > 20:
            print(f"      … 그리고 {len(wrong) - 20}개 더")

    if gone or wrong:
        print("\n  사전을 다시 만들 때 손질이 빠졌습니다. 낱말은 그대로 다 나가므로")
        print("  표현률로도 화면으로도 안 잡힙니다 — 뜻만 조용히 틀려집니다.")
        print("  bash ml/jobs/rebuild_data.sh 로 다시 만드세요.")
        return 1

    print(f"  ✓ 손질 {len(want) - len(missing_clip)}건이 모두 배포본에 살아 있습니다")
    return 0


if __name__ == "__main__":
    sys.exit(main())

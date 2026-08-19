#!/usr/bin/env python3
"""지문자(FS) 라벨을 **키포인트 없이** 재 본다.

    python3 ml/tools/fs_report.py ~/sbdata/sl-crowd

**왜 라벨만 재나.** 키포인트(12GB)는 API 키가 있어야 받는다. 그런데 라벨(8MB)만으로도
"이 데이터로 지문자를 학습할 수 있는가"에 답할 수 있다 — 자모가 골고루 나오는지,
정말 자모를 하나씩 쓰는 것인지. 받기 전에 알아야 헛되이 12GB를 받지 않는다.

**자모를 하나씩 쓰는지 어떻게 아나.** 라벨은 낱말 하나(`충정로`)뿐이고 자모별
시각은 없다. 대신 **표시 구간의 길이**를 본다. 낱말을 통째로 흉내 내는 동작이라면
길이가 자모 개수와 무관해야 하고, 하나씩 쓰는 것이라면 자모 개수에 비례해야 한다.
"""
from __future__ import annotations

import argparse
import collections
import json
import math
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ml.signbridge.jamo import decompose  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("root", type=Path, help="형태소 JSON 루트 (CROWD morpheme)")
    a = ap.parse_args()

    files = sorted(a.root.rglob("*_morpheme.json"))
    if not files:
        print(f"[fs] {a.root} 아래에 형태소 JSON이 없습니다")
        return 1

    words = collections.Counter()
    jamos = collections.Counter()
    rows: list[tuple[int, float]] = []
    stripped = 0

    for path in files:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        for entry in data.get("data") or []:
            for attr in entry.get("attributes") or []:
                raw = attr.get("name")
                if not raw:
                    continue
                name = str(raw).strip()
                if name != str(raw):
                    stripped += 1
                words[name] += 1
                units = decompose(name)
                for unit in units:
                    jamos[unit] += 1
                try:
                    span = float(entry["end"]) - float(entry["start"])
                except (KeyError, TypeError, ValueError):
                    continue
                rows.append((len(units), span))

    print(f"[fs] 형태소 파일 {len(files)}개 · 라벨 {sum(words.values())}건")
    print(f"[fs] 낱말 {len(words)}종 (양끝 공백이 붙어 있던 라벨 {stripped}건 — 정리함)")

    hangul = {k: v for k, v in jamos.items() if "ㄱ" <= k <= "ㅣ"}
    other = {k: v for k, v in jamos.items() if not ("ㄱ" <= k <= "ㅣ")}
    print(f"[fs] 자모 {len(hangul)}종 · {sum(hangul.values())}회")
    print(f"     한글 아닌 기호 {len(other)}종 · {sum(other.values())}회 (숫자·영문)")

    order = sorted(hangul.items(), key=lambda kv: -kv[1])
    print(f"     가장 흔한 5: {order[:5]}")
    print(f"     가장 드문 5: {order[-5:]}")
    thin = [k for k, v in order if v < 100]
    if thin:
        print(f"     100회 미만 {len(thin)}종: {' '.join(thin)}  ← 여기서 먼저 틀린다")

    if len(rows) > 2:
        xs = [r[0] for r in rows]
        ys = [r[1] for r in rows]
        mx, my = statistics.mean(xs), statistics.mean(ys)
        num = sum((x - mx) * (y - my) for x, y in rows)
        den = math.sqrt(sum((x - mx) ** 2 for x in xs) * sum((y - my) ** 2 for y in ys))
        r = num / den if den else 0.0
        print(f"\n[fs] 자모 개수 ↔ 구간 길이 상관 r = {r:.3f}")
        by = collections.defaultdict(list)
        for n, span in rows:
            by[n].append(span)
        wide = [(n, statistics.median(v)) for n, v in sorted(by.items()) if len(v) >= 30]
        if len(wide) >= 2:
            (n0, s0), (n1, s1) = wide[0], wide[-1]
            per = (s1 - s0) / max(1, n1 - n0)
            print(f"     자모 하나에 약 {per:.2f}초 ({n0}자모 {s0:.2f}s → {n1}자모 {s1:.2f}s)")
        print("     r이 0.8을 넘으면 낱말 흉내가 아니라 **자모를 하나씩 쓰는 것**이다.")

    lens = collections.Counter(len(decompose(w)) for w in words)
    print(f"\n[fs] 낱말당 자모 개수 — 중앙값 {statistics.median([len(decompose(w)) for w in words]):.0f}"
          f" · 최대 {max(lens)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""마우징 표를 만든다 — 글로스 → 그때 입으로 내는 한국어 낱말.

    python3 ml/tools/build_mouthing.py            # public/data/mouthing.json
    python3 ml/tools/build_mouthing.py --report   # 만들지 않고 통계만

**마우징이 무엇인가.** 수어를 하면서 입으로 한국어 낱말을 소리 없이 발음하는 것이다.
같은 손동작이 여러 뜻을 가질 때 입모양이 뜻을 가른다 — 수어의 일부지 장식이 아니다.

**원본.** AI Hub 수어스크립트 엑셀(`~/sbdata/nms-script`)의 `Mmo` 채널.
131개 파일에 29,352건 · 낱말 3,435종이 시간 구간까지 붙어 있다(2026-08-20 실측).
같은 파일의 8채널 중 **descriptor(무엇을)가 채워진 것은 Mmo뿐**이다 —
눈썹(EBf) 7건, 고개(Hno) 10건뿐이라 "언제 움직이는지"만 알고 "어떻게"는 모른다.
그래서 눈썹·고개는 여기서 만들지 않는다.

**어떻게 잇나.** Mmo 구간과 글로스 구간의 **겹치는 시간**이 가장 긴 짝을 고른다.
한 글로스에 여러 마우징이 붙으면 가장 자주 나온 것을 쓴다.
"""
from __future__ import annotations
import argparse, glob, json, os, re
from collections import Counter, defaultdict
from pathlib import Path

NMS = Path.home() / "sbdata" / "nms-script"
OUT = Path("public/data/mouthing.json")
# 손동작 층렬 — 셋을 합쳐 시간순으로 본다(CLAUDE.md의 함정 표에 있는 그대로).
TIERS = ("sign_gestures_both", "sign_gestures_strong", "sign_gestures_weak")


def rows_of(path: str):
    import openpyxl
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb[wb.sheetnames[0]]
    out = list(ws.iter_rows(values_only=True))
    wb.close()
    return out


def parse(path: str):
    """한 파일에서 (글로스 구간들, 마우징 구간들)을 뽑는다."""
    rows = rows_of(path)
    glosses: list[tuple[str, float, float]] = []
    mouths: list[tuple[str, float, float]] = []
    cur = None
    pending: dict[str, list] = {}

    def flush(tag, labels, starts, ends, into):
        for i, lab in enumerate(labels):
            if lab in (None, ""):
                continue
            try:
                s = float(starts[i]); e = float(ends[i])
            except (IndexError, TypeError, ValueError):
                continue
            # 라벨에 개행·공백이 섞여 있다 — 안 떼면 같은 낱말이 둘로 갈린다.
            into.append((str(lab).strip(), s, e))

    for r in rows:
        c0 = r[0].strip() if isinstance(r[0], str) else ""
        c1 = r[1].strip() if isinstance(r[1], str) else ""
        if c0 and c0 != "Information":
            cur = c0
            pending = {}
        if not cur:
            continue
        vals = list(r[2:])
        if cur in TIERS:
            # 손동작 줄은 라벨이 c0줄 자체에 실려 있고, 다음 두 줄이 start/end다.
            if c1.startswith("end"):
                flush(cur, pending.get("lab", []), pending.get("start", []), vals, glosses)
                pending = {}
            elif c1.startswith("start") or (not c1 and "start" not in pending and "lab" in pending):
                pending["start"] = vals
            elif not c1 and "lab" in pending:
                pending["start"] = vals
            else:
                pending["lab"] = vals
        elif cur == "Mmo":
            if c1.startswith("descriptor"):
                pending["lab"] = vals
            elif c1.startswith("start"):
                pending["start"] = vals
            elif c1.startswith("end"):
                flush(cur, pending.get("lab", []), pending.get("start", []), vals, mouths)
                pending = {}
    return glosses, mouths


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", action="store_true", help="만들지 않고 통계만 낸다")
    ap.add_argument("--min-count", type=int, default=2,
                    help="이만큼은 같이 나와야 표에 넣는다(한 번뿐인 짝은 잡음일 수 있다)")
    a = ap.parse_args()

    files = sorted(glob.glob(str(NMS / "**" / "*.xlsx"), recursive=True))
    if not files:
        print(f"[마우징] 원본이 없습니다 — {NMS}")
        return 1

    pair: dict[str, Counter] = defaultdict(Counter)
    ng = nm = 0
    for i, f in enumerate(files):
        try:
            gl, mo = parse(f)
        except Exception as err:  # 파일 하나가 깨져도 나머지를 계속 본다
            print(f"  · 건너뜀 {os.path.basename(f)} — {err}")
            continue
        ng += len(gl); nm += len(mo)
        for g, gs, ge in gl:
            best, bestOv = None, 0.0
            for m, ms, me in mo:
                ov = min(ge, me) - max(gs, ms)
                if ov > bestOv:
                    bestOv, best = ov, m
            # 겹침이 글로스 길이의 30%는 돼야 같은 자리로 본다.
            if best and bestOv >= 0.30 * max(1e-6, ge - gs):
                pair[g][best] += 1
        if (i + 1) % 25 == 0:
            print(f"  · {i + 1}/{len(files)} 파일")

    table = {}
    for g, c in pair.items():
        w, n = c.most_common(1)[0]
        if n >= a.min_count:
            table[g] = w
    print(f"[마우징] 파일 {len(files)} · 글로스 구간 {ng:,} · 마우징 구간 {nm:,}")
    print(f"[마우징] 짝지어진 글로스 {len(pair):,}종 → {a.min_count}회 이상 {len(table):,}종")
    if pair:
        ex = sorted(pair.items(), key=lambda kv: -sum(kv[1].values()))[:10]
        print("  상위:", " · ".join(f"{g}→{c.most_common(1)[0][0]}({sum(c.values())})" for g, c in ex))
    if a.report:
        return 0
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(table, ensure_ascii=False), encoding="utf-8")
    print(f"[마우징] 저장 {OUT} ({OUT.stat().st_size / 1024:.0f}KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

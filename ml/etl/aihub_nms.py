#!/usr/bin/env python3
"""수어스크립트(xlsx)에서 **비수지 요소**를 뽑아 글로스와 맞춰 본다.

    python3 ml/etl/aihub_nms.py --src ~/sbdata/nms-script --out public/data/nonmanual.json

**왜 필요한가.** 지금 아바타는 손만 움직인다. 그런데 수어에서 부정·의문·강조는
얼굴과 고개가 나른다. 그게 없으면 문장이 밋밋할 뿐 아니라 **부정문이 부정으로
보이지 않는다.**

원본에 비수지 주석이 있다(오래도록 "없다"고 적어 두었던 것을 2026-08-18에 정정).
채널 8개가 시간 구간과 함께 붙어 있다:

    Ci · Hs(고개 흔들기) · EBf(눈썹) · Hno(고개 끄덕임)
    Mmo(마우징) · Mo1 · Tbt · Mctr(입)

**다만 `descriptor`(어떻게)는 대부분 비어 있다.** 채워진 것은 `Mmo`뿐이고, 값은
입으로 말하는 한국어 낱말이다. 즉 "언제 움직이는지"는 알아도 "눈썹이 올라갔는지
찌푸렸는지"는 모른다. 판정 의문문과 설명 의문문은 눈썹 방향이 반대라, 그것을
규칙으로 지어내면 **틀린 문법을 가르치는 셈**이다. 그래서 여기서는

  - 뜻이 분명한 것(고개 끄덕임·흔들기)과
  - 값이 있는 것(마우징)만

글로스에 붙이고, 나머지는 **"이 구간에 움직임이 있었다"는 빈도만** 남긴다.

붙이는 방법도 지어내지 않는다. 문장 안에서 **어느 글로스와 겹쳤는지**를 세어,
특정 글로스에서 눈에 띄게 자주 나타나면 그 글로스의 성질로 본다.
(예: '하지마'에서 고개 흔들기가 압도적이면 그건 그 낱말의 일부다.)
"""
from __future__ import annotations

import argparse
import collections
import json
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
NMS_CHANNELS = {"Ci", "Hs", "EBf", "Hno", "Mmo", "Mo1", "Tbt", "Mctr"}

# **통계로 후보를 좁히고 사람이 확정한다** — 이 프로젝트에서 여러 번 쓴 방식이다.
#
# 배수(lift)만으로 고르면 뜻이 안 맞는 것이 섞인다(실측: 고개 흔들기에 '지진'·'사다',
# 끄덕임에 'cm'). **잘못된 수어는 표현되지 않은 것보다 나쁘므로** 뜻이 분명한 것만
# 남긴다. 여기 있는데 측정에서 떨어진 낱말은 실행할 때 알려 준다.
ALLOW_SHAKE = {          # 부정 — 고개를 젓는다
    "하지마", "아니다", "안되다", "불가능", "상관없다", "거절", "못하다",
    "금지", "모르다", "없다", "싫다", "반대",
}
ALLOW_NOD = {            # 당부·확인·공감 — 고개를 끄덕인다
    "조심", "부탁", "알아두다", "괜찮다", "미안하다", "안내", "허락",
    "대비", "중요", "이해", "확인", "맞다",
}
GESTURE_ROWS = {"sign_gestures_both", "sign_gestures_strong", "sign_gestures_weak"}
LEMMA_RE = re.compile(r"[0-9#:@]+$")


def sheet_rows(path: Path) -> list[dict[str, str]]:
    """xlsx 첫 시트를 {열문자: 값} 목록으로. 열 위치가 곧 시간축이라 열을 살려야 한다."""
    z = zipfile.ZipFile(path)
    shared: list[str] = []
    if "xl/sharedStrings.xml" in z.namelist():
        root = ET.fromstring(z.read("xl/sharedStrings.xml"))
        for si in root.findall(NS + "si"):
            shared.append("".join(t.text or "" for t in si.iter(NS + "t")))
    sheet = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
    rows: list[dict[str, str]] = []
    for row in sheet.iter(NS + "row"):
        cells: dict[str, str] = {}
        for c in row.iter(NS + "c"):
            ref = c.get("r") or ""
            col = "".join(ch for ch in ref if ch.isalpha())
            v = c.find(NS + "v")
            if v is None or v.text is None:
                continue
            cells[col] = shared[int(v.text)] if c.get("t") == "s" else v.text
        rows.append(cells)
    return rows


def parse_blocks(rows: list[dict[str, str]]) -> list[dict]:
    """한 파일 안의 문장 블록들로 나눈다.

    구조는 이렇게 생겼다(행 단위):
        Information | File name : | <파일명>
                    | Korean sentence : | <원문>
        <채널>      | descriptor : | (열마다 값)
                    | start(s) :   | (열마다 초)
                    | end(s) :     | (열마다 초)
        sign_gestures_both | gloss_id : | (열마다 글로스)
                           | start(s) : | ...
                           | end(s) :   | ...
    같은 **열**에 있는 값끼리 짝이다.
    """
    blocks: list[dict] = []
    cur: dict | None = None
    i = 0
    while i < len(rows):
        r = rows[i]
        a, b = r.get("A", ""), r.get("B", "")
        if a == "Information" and b.startswith("File name"):
            cur = {"file": r.get("C", ""), "text": "", "nms": [], "glosses": []}
            blocks.append(cur)
            i += 1
            continue
        if cur is None:
            i += 1
            continue
        if b.startswith("Korean sentence"):
            cur["text"] = r.get("C", "")
            i += 1
            continue
        if a in NMS_CHANNELS or a in GESTURE_ROWS:
            head, start_row, end_row = r, rows[i + 1] if i + 1 < len(rows) else {}, \
                rows[i + 2] if i + 2 < len(rows) else {}
            if not str(start_row.get("B", "")).startswith("start"):
                i += 1
                continue
            cols = sorted(set(start_row) | set(end_row) | set(head), key=lambda c: (len(c), c))
            for col in cols:
                if col == "B":
                    continue
                s, e = start_row.get(col), end_row.get(col)
                if s is None:
                    continue
                try:
                    start = float(s)
                    end = float(e) if e is not None else start
                except ValueError:
                    continue
                if a in NMS_CHANNELS:
                    cur["nms"].append({"ch": a, "start": start, "end": end,
                                       "desc": head.get(col, "")})
                else:
                    g = head.get(col)
                    if g:
                        cur["glosses"].append({"gloss": g, "start": start, "end": end})
            i += 3
            continue
        i += 1
    return blocks


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", type=Path, required=True, help="추출한 수어스크립트 폴더")
    ap.add_argument("--out", type=Path, default=Path("public/data/nonmanual.json"))
    ap.add_argument("--min-count", type=int, default=60,
                    help="이보다 드문 글로스는 붙이지 않는다(우연을 성질로 오해하지 않게)")
    ap.add_argument("--min-lift", type=float, default=3.5,
                    help="평균 대비 이 배수 이상 함께 나와야 그 낱말의 성질로 본다")
    ap.add_argument("--min-rate", type=float, default=0.02,
                    help="배수가 커도 절대 빈도가 너무 낮으면 버린다")
    a = ap.parse_args()

    files = sorted(a.src.rglob("*.xlsx"))
    print(f"[nms] 수어스크립트 {len(files)}개")

    total = collections.Counter()          # 글로스 등장 횟수
    with_ch: dict[str, collections.Counter] = {c: collections.Counter() for c in NMS_CHANNELS}
    mouthing: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    sentences = 0

    for n, f in enumerate(files, 1):
        try:
            blocks = parse_blocks(sheet_rows(f))
        except Exception as e:  # noqa: BLE001
            print(f"  ⚠️ {f.name}: {e}")
            continue
        for blk in blocks:
            if not blk["glosses"]:
                continue
            sentences += 1
            for g in blk["glosses"]:
                lemma = LEMMA_RE.sub("", g["gloss"])
                if not lemma:
                    continue
                total[lemma] += 1
                for ev in blk["nms"]:
                    # 겹치면 그 글로스에 걸린 것으로 본다(구간이 짧아 대개 하나에만 걸린다)
                    if ev["start"] < g["end"] and ev["end"] > g["start"]:
                        with_ch[ev["ch"]][lemma] += 1
                        if ev["ch"] == "Mmo" and ev["desc"]:
                            mouthing[lemma][ev["desc"]] += 1
        if n % 40 == 0:
            print(f"  [nms] {n}/{len(files)} · 문장 {sentences:,}", flush=True)

    print(f"[nms] 문장 {sentences:,} · 글로스 {len(total):,}종")
    for ch in sorted(NMS_CHANNELS):
        print(f"  {ch:5s} 겹친 글로스 {len(with_ch[ch]):,}종 · 총 {sum(with_ch[ch].values()):,}회")

    # 원자료를 남긴다 — 문턱값을 다시 잡을 때마다 엑셀 131개를 또 훑지 않게.
    raw = a.out.with_name("nonmanual_counts.json")
    raw.write_text(json.dumps({
        "sentences": sentences,
        "total": dict(total),
        "with": {c: dict(with_ch[c]) for c in NMS_CHANNELS},
        "mouthing": {g: dict(w) for g, w in mouthing.items()},
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"[nms] 원자료 → {raw}")

    # **어느 정도라야 '그 낱말의 성질'인가.** 절대 비율만 보면 안 된다 — 비수지는
    # 문장 어디에나 흩어져 있어서, 흔한 낱말은 우연히도 자주 겹친다. 그래서
    # **평균 대비 몇 배인지(lift)** 를 함께 본다.
    for ch, label in (("Hno", "고개 끄덕임"), ("Hs", "고개 흔들기")):
        base = sum(with_ch[ch].values()) / max(1, sum(total.values()))
        rows = [(c / total[g], c / total[g] / base if base else 0, g, c, total[g])
                for g, c in with_ch[ch].items() if total[g] >= a.min_count]
        rows.sort(reverse=True)
        print(f"\n  [{label}] 평균 동반율 {100 * base:.1f}% · 상위 15 (비율 · 배수 · 낱말 · 횟수/전체)")
        for rate, lift, g, c, t in rows[:15]:
            print(f"    {100 * rate:5.1f}%  ×{lift:4.1f}  {g:12s} {c}/{t}")

    # **뜻이 분명한 것만 낱말의 성질로 붙인다.**
    out: dict[str, dict] = {"nod": {}, "shake": {}, "mouth": {}, "_meta": {
        "sentences": sentences, "min_count": a.min_count, "min_rate": a.min_rate,
        "note": "Hno=고개 끄덕임 · Hs=고개 흔들기 · Mmo=마우징(입으로 말하는 낱말). "
                "눈썹(EBf)은 방향 정보가 없어 붙이지 않는다.",
    }}
    # **절대 비율이 아니라 배수(lift)로 고른다.**
    #
    # 주석이 고르다. 글로스 301만 회 출현 중 비수지가 겹친 것은 **15.3%**뿐인데,
    # 실제 수어는 얼굴이 그보다 훨씬 자주 움직인다. 즉 이 주석은 "매번"이 아니라
    # **주석자가 의미 있다고 본 순간**을 표시한 것이다. 그래서 "이 낱말의 몇 %에
    # 붙었나"가 아니라 "평균보다 몇 배 자주 붙었나"를 봐야 한다.
    #
    # 그렇게 보면 방향이 분명하다(실측):
    #   고개 흔들기 — 거절 ×45 · 불가능 ×31 · 안되다 ×31 · 아니다 ×23 · 하지마 ×16
    #   고개 끄덕임 — 조심 ×6.5(66,748회) · 알아두다 ×4.5 · 부탁 ×4.0(39,445회)
    # 부정에는 흔들기, 당부에는 끄덕임 — 수어 문법과 그대로 맞는다.
    for key, ch, allow in (("nod", "Hno", ALLOW_NOD), ("shake", "Hs", ALLOW_SHAKE)):
        base = sum(with_ch[ch].values()) / max(1, sum(total.values()))
        kept, dropped = [], []
        for lemma, c in with_ch[ch].items():
            t = total[lemma]
            rate = c / t
            strong = t >= a.min_count and rate >= a.min_rate and base and rate / base >= a.min_lift
            if strong and lemma in allow:
                out[key][lemma] = round(rate, 3)
                kept.append(lemma)
            elif strong:
                dropped.append(f"{lemma}(×{rate / base:.0f})")
        missing = sorted(allow - set(kept))
        print(f"\n  [{key}] 확정 {len(kept)}종: {sorted(kept)}")
        if dropped:
            print(f"    통계는 셌지만 목록에 없어 뺀 것: {dropped[:12]}")
        if missing:
            print(f"    목록에 있으나 근거가 약해 못 넣은 것: {missing}")
    for lemma, words in mouthing.items():
        if total[lemma] >= a.min_count:
            word, c = words.most_common(1)[0]
            # 마우징은 **입으로 말하는 낱말이 그 글로스와 같을 때만** 쓴다.
            # 다른 낱말을 말하는 경우는 문장마다 달라서 낱말의 성질이 아니다.
            if word == lemma and c >= 3:
                out["mouth"][lemma] = word

    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"[nms] 고개 끄덕임 {len(out['nod'])}종 · 고개 흔들기 {len(out['shake'])}종 · "
          f"마우징 {len(out['mouth'])}종 → {a.out}")
    for key in ("nod", "shake"):
        top = sorted(out[key].items(), key=lambda kv: -kv[1])[:12]
        print(f"  {key}: {top}")


if __name__ == "__main__":
    main()

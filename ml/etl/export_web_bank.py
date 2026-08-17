"""동작 사전에서 **웹에 실을 부분만** 추려 정적 파일로 내보낸다.

    python -m ml.etl.export_web_bank --bank <데이터>/glossbank --index <데이터>/ksl \
        --out public/data --top 3000

전체 사전은 약 1GB라 GitHub Pages에 통째로 올릴 수 없다. 다행히 재난문자 어휘는
편중돼 있어서 **상위 3,000종이 전체 출현의 95.8%** 를 덮는다(실측). 그만큼만 싣는다.

용량을 줄이는 세 가지:
  1. 빈도 상위 N종만 (커버리지는 로그로 보고한다 — 조용히 자르지 않는다)
  2. 좌표를 **정수로 반올림**. 픽셀 좌표라 소수점 이하는 아바타에 보이지 않는다.
  3. 신뢰도(conf)를 **0/1로 이진화**. 리타게팅은 "검출됐나"만 보고 값 크기는 안 쓴다.
     텍스트 JSON에서 "0.8734"가 "1"이 되면 글자 수가 크게 준다.

3D(keypoints3d)는 싣지 않는다. 웹 리타게팅은 3D가 있으면 그걸 우선 쓰는데, 2D 조각과
섞이면 프레임마다 기준이 바뀌어 팔이 튄다. 정적본은 2D로 통일하는 편이 안전하다.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ml.signbridge.vocab import normalize_gloss  # noqa: E402

CONF_THRESHOLD = 0.1


def compact(entry: dict) -> dict:
    """좌표 반올림 + 신뢰도 이진화. 구조는 SignData 그대로 둔다.

    수어영상 WORD 클립은 좌표가 **미터 단위**(±3)라 그대로 정수 반올림하면
    동작이 0/1로 뭉개진다. 좌표 크기를 보고 미터로 판단되면 mm로 환산해
    정수 정밀도를 지킨다(어깨 정규화가 단위를 흡수하므로 재생엔 영향 없다).
    """
    pose_vals = [abs(v) for row in entry["keypoints"].get("pose", []) for v in row if v]
    pose_vals.sort()
    med = pose_vals[len(pose_vals) // 2] if pose_vals else 0.0
    factor = 1000.0 if 0 < med < 10.0 else 1.0

    out = {
        "korean_text": entry.get("korean_text", ""),
        "fps": entry.get("fps", 30.0),
        "num_frames": entry.get("num_frames", 0),
        "gloss_sequence": entry.get("gloss_sequence", []),
        "keypoints": {},
    }
    for key, frames in entry["keypoints"].items():
        packed = []
        for row in frames:
            new = []
            for i in range(0, len(row), 3):
                x, y, c = row[i], row[i + 1], row[i + 2]
                if c < CONF_THRESHOLD or (x == 0 and y == 0):
                    new.extend((0, 0, 0))
                else:
                    new.extend((round(x * factor), round(y * factor), 1))
            packed.append(new)
        out["keypoints"][key] = packed
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="웹 배포용 동작 사전 추출")
    parser.add_argument("--bank", type=Path, required=True, help="build_gloss_bank 산출 디렉터리")
    parser.add_argument("--index", type=Path, required=True, nargs="+",
                        help="빈도를 셀 index.jsonl 디렉터리(복수 가능 — 재난+일상)")
    parser.add_argument("--out", type=Path, required=True, help="public/data")
    parser.add_argument("--top", type=int, default=3000)
    parser.add_argument("--must", type=Path, nargs="*", default=None,
                        help="빈도와 무관하게 반드시 실을 낱말 목록(한 줄에 하나, 복수 가능)")
    parser.add_argument("--clean", action="store_true",
                        help="기존 조각을 모두 지우고 다시 쓴다(기본은 증분)")
    args = parser.parse_args()

    bank = json.loads((args.bank / "bank.json").read_text(encoding="utf-8"))
    print(f"[web] 전체 사전 {len(bank):,}종")

    freq: Counter = Counter()
    for index_dir in args.index:
        for line in open(index_dir / "index.jsonl", encoding="utf-8"):
            for g in json.loads(line)["glosses"]:
                name = normalize_gloss(g.get("gloss", ""))
                if name:
                    freq[name] += 1
    total = sum(freq.values())

    # "날짜:9월16일"·"시:15"·"시간:2시간" 같은 **주석 클립은 싣지 않는다.** 낱말이 아니라
    # 그 문장에만 해당하는 숫자 주석이라, 번역 후보로 쓰면 "주택→날짜:9월16일" 같은
    # 엉뚱한 동작이 나온다(실측에서 낱말 2만 개가 이런 상태였다). 숫자·시각은 앱이
    # 직접 읽어 표현한다(numberGlosses). 싣지 않으면 용량도 20MB쯤 준다.
    chosen = [g for g, _ in freq.most_common() if g in bank and ":" not in g][: args.top]
    covered = sum(freq[g] for g in chosen)
    print(
        f"[web] 상위 {len(chosen):,}종 선택 → 출현 커버리지 {100 * covered / total:.1f}%"
        f" (전체 출현 {total:,}회)"
    )

    # 빈도만으로 고르면 **일상어가 통째로 잘린다.** 빈도는 재난문자 말뭉치에서 세는데,
    # 앱이 서는 자리는 병원·택시·관공서 창구다. 실측에서 결과·수술·도장·요금·안전벨트·
    # 알레르기 같은 낱말이 전체 사전에는 있는데 웹 사전에서 빠져 있었다 — 그 자리에서
    # 가장 필요한 말들이다. 그래서 생활 어휘는 빈도와 무관하게 싣는다.
    if args.must:
        want = {
            w.strip()
            for path in args.must
            for w in path.read_text(encoding="utf-8").splitlines()
            if w.strip() and not w.startswith("#")
        }
        lemma_re = re.compile(r"[0-9#:]+$")
        by_lemma: dict[str, list[str]] = {}
        for g in bank:
            by_lemma.setdefault(lemma_re.sub("", g), []).append(g)
        have = set(chosen)
        added, hit = [], 0
        for word in sorted(want):
            variants = by_lemma.get(word)
            if not variants:
                continue
            hit += 1
            # 표제어당 변이형 둘까지만 — 하나는 기본형, 하나는 대안. 그 이상은 용량만 먹는다.
            for g in sorted(variants)[:2]:
                if g not in have:
                    have.add(g)
                    added.append(g)
        chosen = chosen + added
        print(f"[web] 생활 어휘 {len(want):,}개 중 사전에 있는 것 {hit:,}개 → 조각 {len(added):,}종 추가")
        missing = sorted(w for w in want if w not in by_lemma)
        if missing:
            print(f"[web] 사전에 없는 생활 어휘 {len(missing)}개: {missing[:15]}")

    gloss_dir = args.out / "glosses"
    if args.clean and gloss_dir.exists():
        shutil.rmtree(gloss_dir)
    gloss_dir.mkdir(parents=True, exist_ok=True)

    # 증분이 기본이다. 어휘를 조금 늘릴 때마다 9,500개를 다시 쓰면 30분이 날아가고,
    # 그동안 public/data/glosses가 비어 앱이 통째로 멈춘다(rmtree 후 재작성 구간).
    existing = {f.name for f in gloss_dir.glob("*.json")}
    keep = {bank[n]["file"] for n in chosen}

    web_index: dict[str, dict] = {}
    written = reused = 0
    for name in chosen:
        info = bank[name]
        target = gloss_dir / info["file"]
        if info["file"] in existing:
            data = json.loads(target.read_text(encoding="utf-8"))
            reused += 1
        else:
            raw = json.loads((args.bank / "glosses" / info["file"]).read_text(encoding="utf-8"))
            data = compact(raw)
            target.write_text(
                json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
            )
            written += 1
            if written % 200 == 0:
                print(f"  [web] 새로 쓴 조각 {written:,}", flush=True)
        web_index[name] = {
            "file": info["file"],
            "frames": data["num_frames"],
            "fps": data["fps"],
        }

    stale = existing - keep
    for f in stale:
        (gloss_dir / f).unlink()
    print(f"[web] 새로 {written:,}종 · 재사용 {reused:,}종 · 정리 {len(stale):,}종")

    (args.out / "bank.json").write_text(
        json.dumps(web_index, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )

    size = sum(f.stat().st_size for f in gloss_dir.glob("*.json"))
    print(f"[web] {written:,}종 → {gloss_dir} ({size / 1e6:.0f}MB)")
    print(f"[web] 색인 → {args.out / 'bank.json'}")
    if size > 900e6:
        print("[web] ⚠️ 1GB에 근접합니다 — --top을 줄이세요(GitHub Pages 권장 상한).")


if __name__ == "__main__":
    main()

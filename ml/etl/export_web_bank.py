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
import shutil
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ml.signbridge.vocab import normalize_gloss  # noqa: E402

CONF_THRESHOLD = 0.1


def compact(entry: dict) -> dict:
    """좌표 반올림 + 신뢰도 이진화. 구조는 SignData 그대로 둔다."""
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
                    new.extend((round(x), round(y), 1))
            packed.append(new)
        out["keypoints"][key] = packed
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="웹 배포용 동작 사전 추출")
    parser.add_argument("--bank", type=Path, required=True, help="build_gloss_bank 산출 디렉터리")
    parser.add_argument("--index", type=Path, required=True, help="빈도를 셀 index.jsonl 디렉터리")
    parser.add_argument("--out", type=Path, required=True, help="public/data")
    parser.add_argument("--top", type=int, default=3000)
    args = parser.parse_args()

    bank = json.loads((args.bank / "bank.json").read_text(encoding="utf-8"))
    print(f"[web] 전체 사전 {len(bank):,}종")

    freq: Counter = Counter()
    for line in open(args.index / "index.jsonl", encoding="utf-8"):
        for g in json.loads(line)["glosses"]:
            name = normalize_gloss(g.get("gloss", ""))
            if name:
                freq[name] += 1
    total = sum(freq.values())

    chosen = [g for g, _ in freq.most_common() if g in bank][: args.top]
    covered = sum(freq[g] for g in chosen)
    print(
        f"[web] 상위 {len(chosen):,}종 선택 → 출현 커버리지 {100 * covered / total:.1f}%"
        f" (전체 출현 {total:,}회)"
    )

    gloss_dir = args.out / "glosses"
    if gloss_dir.exists():
        shutil.rmtree(gloss_dir)
    gloss_dir.mkdir(parents=True, exist_ok=True)

    web_index: dict[str, dict] = {}
    written = 0
    for name in chosen:
        info = bank[name]
        raw = json.loads((args.bank / "glosses" / info["file"]).read_text(encoding="utf-8"))
        data = compact(raw)
        (gloss_dir / info["file"]).write_text(
            json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
        )
        web_index[name] = {
            "file": info["file"],
            "frames": data["num_frames"],
            "fps": data["fps"],
        }
        written += 1
        if written % 500 == 0:
            print(f"  [web] {written:,}/{len(chosen):,}", flush=True)

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

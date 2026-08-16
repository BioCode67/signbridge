"""AI Hub 원본의 구조를 **붙여넣기 좋은 크기**로 요약한다.

데이터를 어디에 올릴 필요가 없다. 데이터가 있는 컴퓨터에서 이 파일 하나만 실행하고,
출력된 텍스트(보통 2~5KB)를 그대로 복사해 오면 어댑터를 확정할 수 있다.

**표준 라이브러리만 쓴다.** 저장소를 clone하지 않아도, pip install 하지 않아도 된다.
이 파일 하나만 내려받아 실행하면 된다.

    python3 schema_report.py /path/to/라벨링데이터
    python3 schema_report.py 샘플데이터.zip          # 압축을 풀지 않고 바로 읽는다
    python3 schema_report.py /path/to/data --limit 5 > report.txt

개인정보 주의: 한국어 원문·URL 같은 문자열 값은 앞 40자만 보여 주고, 좌표 값은
개수와 범위만 요약한다(원본 좌표를 그대로 쏟아내지 않는다).
"""

from __future__ import annotations

import argparse
import json
import zipfile
from pathlib import Path
from typing import Any, Iterator

MAX_STRING = 40
MAX_KEYS = 30
MAX_DEPTH = 5

# 어댑터 판정에 쓰는 표식들.
DISASTER_MARKERS = ("sign_script", "sign_gestures_both", "gloss_id", "nms_script")
SL_MARKERS = ("attributes", "metaData", "exportedOn")
KEYPOINT_MARKERS = (
    "pose_keypoints_2d",
    "pose_keypoints_3d",
    "hand_left_keypoints_2d",
    "hand_left_keypoints_3d",
    "people",
)


def describe(value: Any, depth: int = 0) -> Any:
    """구조만 남기고 값은 요약한다."""
    if depth >= MAX_DEPTH:
        return f"<{type(value).__name__}>"

    if isinstance(value, dict):
        items = list(value.items())[:MAX_KEYS]
        out = {key: describe(item, depth + 1) for key, item in items}
        if len(value) > MAX_KEYS:
            out["…"] = f"(+{len(value) - MAX_KEYS} keys)"
        return out

    if isinstance(value, list):
        if not value:
            return "[] (빈 배열)"
        # 숫자만 든 큰 배열(= 좌표)은 개수와 범위만.
        if all(isinstance(v, (int, float)) for v in value):
            numbers = [float(v) for v in value]
            return (
                f"[숫자 {len(value)}개] 범위 {min(numbers):.1f} ~ {max(numbers):.1f} "
                f"| 앞 6개: {[round(n, 2) for n in numbers[:6]]}"
            )
        return {f"list[{len(value)}]": describe(value[0], depth + 1)}

    if isinstance(value, str):
        return value[:MAX_STRING] + ("…" if len(value) > MAX_STRING else "")

    return value


def walk_keys(value: Any, depth: int = 0) -> Iterator[str]:
    if depth > MAX_DEPTH:
        return
    if isinstance(value, dict):
        for key, item in value.items():
            yield key
            yield from walk_keys(item, depth + 1)
    elif isinstance(value, list) and value:
        yield from walk_keys(value[0], depth + 1)


def iter_json(path: Path, limit: int) -> Iterator[tuple[str, Any]]:
    """파일·디렉터리·zip 어디서든 JSON을 꺼내 준다."""
    if path.is_dir():
        files = sorted(path.rglob("*.json"))[:limit]
        for file in files:
            try:
                yield str(file.relative_to(path)), json.loads(file.read_text(encoding="utf-8"))
            except Exception as error:
                yield str(file), {"__파싱실패__": f"{type(error).__name__}: {error}"}
        return

    if path.suffix.lower() == ".zip":
        with zipfile.ZipFile(path) as archive:
            names = [n for n in archive.namelist() if n.lower().endswith(".json")][:limit]
            print(f"  (zip 안 JSON {len(archive.namelist())}개 중 {len(names)}개 확인)\n")
            for name in names:
                try:
                    with archive.open(name) as handle:
                        yield name, json.loads(handle.read().decode("utf-8"))
                except Exception as error:
                    yield name, {"__파싱실패__": f"{type(error).__name__}: {error}"}
        return

    yield path.name, json.loads(path.read_text(encoding="utf-8"))


def verdict(all_keys: set[str]) -> list[str]:
    """어떤 어댑터를 써야 하는지 판정한다."""
    lines: list[str] = []
    disaster = [m for m in DISASTER_MARKERS if m in all_keys]
    sign_language = [m for m in SL_MARKERS if m in all_keys]
    keypoints = [m for m in KEYPOINT_MARKERS if m in all_keys]

    if disaster:
        lines.append(f"✅ 재난안전 형태소 JSON으로 보입니다 (발견: {disaster})")
        lines.append("   → python -m ml.etl.aihub_disaster --input <디렉터리> --out <출력>")
        if "landmarks" in all_keys:
            lines.append("   → landmarks 포함 = 키포인트 XML을 따로 받을 필요 없습니다.")
        else:
            lines.append("   ⚠️ landmarks가 안 보입니다 — 키포인트가 별도 파일일 수 있습니다.")
    elif sign_language and "data" in all_keys:
        lines.append(f"✅ 수어영상 형태소 JSON으로 보입니다 (발견: {sign_language})")
        lines.append("   → python -m ml.etl.aihub_sl --morpheme <형태소> --keypoints <키포인트>")
    elif keypoints:
        lines.append(f"✅ 키포인트 JSON으로 보입니다 (발견: {keypoints})")
        lines.append("   → 수어영상 경로의 --keypoints 로 지정하세요.")
    else:
        lines.append("❓ 알려진 형식과 일치하지 않습니다. 위 구조 출력을 그대로 공유해 주세요.")

    return lines


def main() -> None:
    parser = argparse.ArgumentParser(description="AI Hub 원본 구조 요약(붙여넣기용)")
    parser.add_argument("path", type=Path, help="JSON 파일 · 디렉터리 · zip")
    parser.add_argument("--limit", type=int, default=3, help="살펴볼 파일 수 (기본 3)")
    args = parser.parse_args()

    if not args.path.exists():
        raise SystemExit(f"경로가 없습니다: {args.path}")

    print("=" * 68)
    print("AI Hub 데이터 구조 요약  —  이 출력을 통째로 복사해 붙여넣으세요")
    print("=" * 68)
    print(f"대상: {args.path}\n")

    all_keys: set[str] = set()
    count = 0

    for name, data in iter_json(args.path, args.limit):
        count += 1
        print("-" * 68)
        print(f"[{count}] {name}")
        print("-" * 68)
        all_keys.update(walk_keys(data))
        print(json.dumps(describe(data), ensure_ascii=False, indent=2))
        print()

    if count == 0:
        raise SystemExit("JSON을 찾지 못했습니다. 경로를 확인하세요.")

    print("=" * 68)
    print("판정")
    print("=" * 68)
    for line in verdict(all_keys):
        print(line)

    interesting = sorted(
        k for k in all_keys if any(t in k.lower() for t in ("gloss", "keypoint", "landmark", "sign", "morph"))
    )
    if interesting:
        print(f"\n관련 키 전체: {interesting}")


if __name__ == "__main__":
    main()

"""AI Hub 원본 JSON 구조를 요약 출력한다.

AI Hub 데이터는 과제·연도·배포 차수마다 필드 이름과 중첩 구조가 조금씩 다르다.
변환기를 붙이기 전에 **실제로 받은 파일이 어떤 모양인지** 먼저 확인하는 용도다.

    python -m ml.etl.inspect_json /data/aihub/라벨링데이터 --limit 3

배열은 길이와 첫 원소만, 긴 문자열은 앞부분만 보여 준다(수십 MB 키포인트 파일을
그대로 찍지 않기 위해).
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

MAX_STRING = 80
MAX_KEYS = 40


def describe(value: Any, depth: int = 0, max_depth: int = 4) -> Any:
    if depth >= max_depth:
        return f"<{type(value).__name__}>"
    if isinstance(value, dict):
        items = list(value.items())[:MAX_KEYS]
        summary = {key: describe(item, depth + 1, max_depth) for key, item in items}
        if len(value) > MAX_KEYS:
            summary["..."] = f"(+{len(value) - MAX_KEYS} keys)"
        return summary
    if isinstance(value, list):
        if not value:
            return "[] (empty)"
        return {
            f"list[{len(value)}]": describe(value[0], depth + 1, max_depth),
        }
    if isinstance(value, str):
        return value[:MAX_STRING] + ("..." if len(value) > MAX_STRING else "")
    return value


def main() -> None:
    parser = argparse.ArgumentParser(description="AI Hub JSON 구조 요약")
    parser.add_argument("path", type=Path, help="JSON 파일 또는 디렉터리")
    parser.add_argument("--limit", type=int, default=3, help="디렉터리일 때 살펴볼 파일 수")
    parser.add_argument("--max-depth", type=int, default=4)
    args = parser.parse_args()

    if args.path.is_dir():
        files = sorted(args.path.rglob("*.json"))[: args.limit]
        if not files:
            raise SystemExit(f"JSON 파일이 없습니다: {args.path}")
    else:
        files = [args.path]

    for file in files:
        size_mb = file.stat().st_size / 1e6
        print(f"\n{'=' * 70}\n{file}  ({size_mb:.2f} MB)\n{'=' * 70}")
        try:
            with open(file, encoding="utf-8") as handle:
                data = json.load(handle)
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            print(f"  파싱 실패: {error}")
            continue
        print(json.dumps(describe(data, max_depth=args.max_depth), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

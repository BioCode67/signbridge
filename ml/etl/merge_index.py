"""샤드별 index 파일을 하나로 합친다.

여러 대(HPC VM 등)에서 `extract_mediapipe.py --num-shards N --shard i`로 나눠 추출하면
`index.shard000.jsonl`, `index.shard001.jsonl` … 이 생긴다. 전부 끝난 뒤 이걸 합쳐야
`prepare.py`가 읽을 `index.jsonl`이 만들어진다.

    python -m ml.etl.merge_index --data /data/signbridge/ksl

같은 클립이 여러 샤드에 중복돼 있으면(재시도 등) **팩이 실제로 존재하는 레코드만** 남기고
id 기준으로 하나만 취한다. 노드가 중간에 죽어 index에는 있는데 팩은 없는 경우가 실제로
생기므로, 존재 확인을 건너뛰면 학습이 로드 실패로 죽는다.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="샤드 index 병합")
    parser.add_argument("--data", type=Path, required=True, help="팩·index가 있는 디렉터리")
    parser.add_argument(
        "--keep-shards", action="store_true", help="병합 후 샤드 파일을 지우지 않는다"
    )
    parser.add_argument(
        "--no-verify", action="store_true", help="팩 파일 존재 확인을 건너뛴다(빠르지만 위험)"
    )
    args = parser.parse_args()

    shard_files = sorted(args.data.glob("index.shard*.jsonl"))
    if not shard_files:
        raise SystemExit(f"샤드 파일이 없습니다: {args.data}/index.shard*.jsonl")

    merged: dict[str, dict] = {}
    duplicates = 0
    missing = 0

    for shard_file in shard_files:
        count = 0
        for line in shard_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            record = json.loads(line)
            if not args.no_verify and not (args.data / record["npz"]).exists():
                missing += 1
                continue
            if record["id"] in merged:
                duplicates += 1
                continue
            merged[record["id"]] = record
            count += 1
        print(f"  {shard_file.name}: {count}개")

    if not merged:
        raise SystemExit("병합할 유효한 레코드가 없습니다.")

    records = [merged[key] for key in sorted(merged)]
    index_path = args.data / "index.jsonl"
    with open(index_path, "w", encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")

    print(f"\n[merge] 클립 {len(records)}개 → {index_path}")
    if duplicates:
        print(f"[merge] 중복 {duplicates}건 제거")
    if missing:
        print(f"[merge] ⚠️ 팩 파일이 없는 레코드 {missing}건 제외 — 해당 샤드를 다시 돌리세요")

    if not args.keep_shards:
        for shard_file in shard_files:
            shard_file.unlink()
        print(f"[merge] 샤드 파일 {len(shard_files)}개 정리 완료")

    print("[merge] 다음: python -m ml.etl.prepare --data", args.data)


if __name__ == "__main__":
    main()

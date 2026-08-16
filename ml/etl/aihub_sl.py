"""AI Hub「수어 영상」(dataSetSn=103) → 랜드마크 팩.

재난안전 데이터와 **구조가 다르다.** 헷갈리면 안 된다.

| | 재난안전 | 수어 영상 |
|---|---|---|
| 키포인트 위치 | 형태소 JSON 안(`landmarks`) | **별도 파일, 프레임당 1개** |
| 좌표 | 3D | **2D**(OpenPose 표준) |
| 글로스 필드 | `sign_script.*[].gloss_id` | **`data[].attributes[].name`** |
| 수어자 정보 | `signer` 필드 | **파일명**(REAL01~20) |

    python -m ml.etl.aihub_sl \
        --morpheme /data/raw/수어영상/라벨링데이터/REAL/SEN \
        --keypoints /data/raw/수어영상/라벨링데이터/REAL/SEN \
        --out /data/signbridge/ksl-sl --workers 16 --angles F

용량 참고(공식 파일 목록 기준)
    형태소 zip 합계   약 0.2 GB   ← 글로스만 필요하면 이것만 받아도 된다
    키포인트 zip 합계  약 400 GB   ← 900 GiB 쿼터 안에 들어간다
    영상 zip 합계     약 2 TB     ← 들어가지 않는다. 받지 말 것

즉 **영상 없이 키포인트만으로 사전학습이 가능하다.**
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ml.signbridge.naming import frame_index, parse_clip_name, strip_suffix  # noqa: E402
from ml.signbridge.openpose import convert_clip  # noqa: E402
from ml.signbridge.pack import save_pack  # noqa: E402

NUM_POSE_OP = 25
NUM_HAND_OP = 21


def read_openpose_json(path: Path) -> tuple[list, list, list]:
    """OpenPose 프레임 JSON에서 pose/left/right 평탄 배열을 꺼낸다.

    `people[0]`에 들어 있는 배포본과 최상위에 바로 있는 배포본을 모두 처리한다.
    """
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)

    holder = data
    people = data.get("people") if isinstance(data, dict) else None
    if isinstance(people, list) and people:
        # 여러 명이 잡히면 포즈 신뢰도 합이 가장 큰 사람을 수어자로 본다.
        holder = max(
            people, key=lambda p: float(np.sum(np.asarray(p.get("pose_keypoints_2d", [0]))[2::3]))
        )

    return (
        holder.get("pose_keypoints_2d") or [],
        holder.get("hand_left_keypoints_2d") or [],
        holder.get("hand_right_keypoints_2d") or [],
    )


def read_morpheme(path: Path) -> tuple[str, list[dict]]:
    """형태소 JSON → (한국어 원문, 글로스 시퀀스).

    구조: {"0": {"metaData": {...}, "data": [{"start","end","attributes":[{"name":...}]}]}}
    start/end가 **문자열**로 오는 점에 주의(가이드 예시가 그렇다).
    """
    with open(path, encoding="utf-8") as handle:
        raw = json.load(handle)

    # {"0": {...}} 한 겹 감싼 형태를 벗긴다.
    record = raw
    if isinstance(raw, dict) and "data" not in raw:
        for value in raw.values():
            if isinstance(value, dict) and "data" in value:
                record = value
                break

    korean = ""
    meta = record.get("metaData") or {}
    for key in ("korean_text", "korean", "sentence", "text", "name"):
        if isinstance(meta.get(key), str) and meta[key]:
            korean = meta[key]
            break

    glosses: list[dict] = []
    for entry in record.get("data") or []:
        if not isinstance(entry, dict):
            continue
        attributes = entry.get("attributes") or []
        name = None
        nonmanual = None
        for attribute in attributes:
            if isinstance(attribute, dict):
                name = name or attribute.get("name")
                nonmanual = nonmanual or attribute.get("attribute")
        if not name:
            continue
        try:
            start = float(entry["start"])
            end = float(entry["end"])
        except (KeyError, TypeError, ValueError):
            continue
        glosses.append(
            {"gloss": str(name), "start": start, "end": end, "nonmanual": nonmanual or []}
        )

    glosses.sort(key=lambda g: (g["start"], g["end"]))
    return korean, glosses


def convert_clip_files(
    stem: str, morpheme_path: Path, keypoint_paths: list[Path], out_dir: Path, fps: float
) -> dict | None:
    if not keypoint_paths:
        return None

    poses, lefts, rights = [], [], []
    for path in keypoint_paths:
        pose, left, right = read_openpose_json(path)
        poses.append(pose)
        lefts.append(left)
        rights.append(right)

    def pad(rows: list, num_points: int) -> np.ndarray:
        width = num_points * 3
        out = np.zeros((len(rows), width), dtype=np.float32)
        for index, row in enumerate(rows):
            values = np.asarray(row, dtype=np.float32).reshape(-1)
            out[index, : min(width, len(values))] = values[:width]
        return out

    arrays = convert_clip(
        {
            "pose": pad(poses, NUM_POSE_OP),
            "hand_left": pad(lefts, NUM_HAND_OP),
            "hand_right": pad(rights, NUM_HAND_OP),
        }
    )

    korean, glosses = read_morpheme(morpheme_path) if morpheme_path else ("", [])
    parsed = parse_clip_name(stem)

    meta = {
        "id": stem,
        "fps": fps,
        "korean_text": korean,
        "glosses": glosses,
        "source": "aihub-sl-2d",
        "has_depth": False,
    }
    rel = f"packs/{stem}.npz"
    save_pack(out_dir / rel, arrays, meta)

    return {
        "id": stem,
        "npz": rel,
        "fps": fps,
        "num_frames": int(arrays["pose"].shape[0]),
        "korean_text": korean,
        "glosses": glosses,
        "signer": parsed.signer if parsed else "",
        "source": "aihub-sl-2d",
        "has_depth": False,
        "angle": parsed.angle if parsed else "",
        "content_id": parsed.content_id if parsed else "",
        "kind": parsed.kind if parsed else "",
    }


def _worker(payload: tuple) -> dict | None:
    stem, morpheme_path, keypoint_paths, out_dir, fps = payload
    try:
        return convert_clip_files(stem, morpheme_path, keypoint_paths, out_dir, fps)
    except Exception as error:
        print(f"  [warn] {stem}: {type(error).__name__}: {error}", flush=True)
        return None


def build_keypoint_index(root: Path) -> dict[str, list[Path]]:
    """키포인트 파일을 클립 스템별로 묶는다.

    클립마다 glob을 돌리면 파일이 수천만 개인 이 데이터셋에서는 끝나지 않는다.
    **한 번만 훑어서** 스템 → 프레임 파일 목록으로 정리한다.
    """
    index: dict[str, list[Path]] = defaultdict(list)
    for path in root.rglob("*_keypoints.json"):
        stem = strip_suffix(path.name)
        if stem:
            index[stem].append(path)
    for stem in index:
        index[stem].sort(key=lambda p: frame_index(p.name))
    return index


def main() -> None:
    parser = argparse.ArgumentParser(description="AI Hub 수어영상 → 랜드마크 팩")
    parser.add_argument("--morpheme", type=Path, required=True, help="형태소 JSON 루트")
    parser.add_argument("--keypoints", type=Path, required=True, help="키포인트 JSON 루트")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument(
        "--angles",
        default="F",
        help="쓸 촬영각도(쉼표). 기본 F만. 'all'이면 5각도 전부(데이터 5배·각도 강건성 ↑)",
    )
    parser.add_argument("--kinds", default="SEN,WRD", help="SEN(문장)/WRD(단어)/FINSP(지문자)")
    parser.add_argument("--fps", type=float, default=30.0)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    angles = None if args.angles.lower() == "all" else {a.strip().upper() for a in args.angles.split(",")}
    kinds = {k.strip().upper() for k in args.kinds.split(",") if k.strip()}
    args.out.mkdir(parents=True, exist_ok=True)

    print("[etl] 키포인트 파일 목록을 훑는 중… (파일 수가 많아 시간이 걸립니다)")
    keypoint_index = build_keypoint_index(args.keypoints)
    print(f"[etl] 키포인트 클립 {len(keypoint_index)}개 발견")

    morpheme_index = {
        strip_suffix(path.name): path for path in args.morpheme.rglob("*_morpheme.json")
    }
    print(f"[etl] 형태소 파일 {len(morpheme_index)}개 발견")

    payloads = []
    skipped_angle = skipped_kind = 0
    for stem, paths in sorted(keypoint_index.items()):
        parsed = parse_clip_name(stem)
        if parsed:
            if kinds and parsed.kind not in kinds:
                skipped_kind += 1
                continue
            if angles is not None and parsed.angle not in angles:
                skipped_angle += 1
                continue
        payloads.append((stem, morpheme_index.get(stem), paths, args.out, args.fps))

    if args.limit:
        payloads = payloads[: args.limit]
    if not payloads:
        raise SystemExit("처리할 클립이 없습니다. --angles/--kinds 조건을 확인하세요.")

    print(
        f"[etl] 변환 대상 {len(payloads)}개 "
        f"(각도 제외 {skipped_angle}, 종류 제외 {skipped_kind}, workers={args.workers})"
    )

    records: list[dict] = []
    if args.workers <= 1:
        results = [_worker(p) for p in payloads]
    else:
        results = []
        with ProcessPoolExecutor(max_workers=args.workers) as pool:
            futures = [pool.submit(_worker, p) for p in payloads]
            for index, future in enumerate(as_completed(futures), start=1):
                results.append(future.result())
                if index % 1000 == 0:
                    print(f"  {index}/{len(payloads)}", flush=True)

    records = [r for r in results if r]
    records.sort(key=lambda r: r["id"])
    index_path = args.out / "index.jsonl"
    with open(index_path, "w", encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")

    no_gloss = sum(1 for r in records if not r["glosses"])
    signers = {r["signer"] for r in records if r["signer"]}
    angles_seen = {r["angle"] for r in records if r["angle"]}
    print(f"\n[etl] 클립 {len(records)}개 → {index_path}")
    print(f"[etl] 수어자 {len(signers)}명 · 각도 {sorted(angles_seen)}")
    if no_gloss:
        print(
            f"[etl] ⚠️ 글로스가 없는 클립 {no_gloss}개 — 형태소 zip을 함께 받았는지 확인하세요"
            " (형태소는 전부 합쳐도 0.2GB 남짓입니다)."
        )
    print("[etl] 다음: python -m ml.etl.prepare --data", args.out, "--split-by signer")


if __name__ == "__main__":
    main()

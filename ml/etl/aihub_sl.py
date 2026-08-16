"""AI Hub「수어 영상」(dataSetSn=103) → 랜드마크 팩.

재난안전 데이터와 **구조가 다르다.** 헷갈리면 안 된다.

| | 재난안전 | 수어 영상 |
|---|---|---|
| 키포인트 위치 | 형태소 JSON 안(`landmarks`) | **별도 파일, 프레임당 1개** |
| 좌표 | 3D | **2D와 3D 둘 다** (3D는 미터 단위, 기본으로 3D 사용) |
| 글로스 필드 | `sign_script.*[].gloss_id` | **`data[].attributes[].name`** |
| 수어자 정보 | `signer` 필드 | **파일명**(REAL01~20) |

실제 배포본을 열어 확인한 사항(가이드 문서만으로는 알 수 없던 것들)
  · `people`이 리스트가 아니라 **딕셔너리**다. 표준 OpenPose와 다르다.
  · 2D는 점당 3값(x, y, conf), **3D는 점당 4값(x, y, z, conf)**. 3으로 가정하면
    좌표가 점 경계를 넘어 뒤섞인다.
  · 파일명의 단어 구분자가 가이드의 `WRD`가 아니라 **`WORD`**다.
  · 프레임 번호는 12자리(`_000000000000_keypoints.json`)이고 클립마다 폴더가 하나씩이다.
  · 카메라 파라미터(`camparam`: Intrinsics/CameraMatrix/Distortion)가 함께 들어 있다.

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
from ml.signbridge.openpose import convert_clip, convert_clip_3d, split_keypoints  # noqa: E402
from ml.signbridge.pack import save_pack  # noqa: E402

NUM_POSE_OP = 25
NUM_HAND_OP = 21


def read_openpose_json(path: Path, prefer_3d: bool = True) -> tuple[list, list, list, bool]:
    """OpenPose 프레임 JSON에서 pose/left/right 평탄 배열을 꺼낸다.

    배포본 편차 두 가지를 모두 처리한다.

    1. **`people`가 리스트가 아니라 딕셔너리인 경우** — OpenPose 표준은
       `"people": [{...}]`이지만, 실제 AI Hub 수어영상 배포본은
       `"people": {"person_id": -1, ...}` 처럼 **딕셔너리 하나**로 들어 있다.
       리스트만 가정하면 좌표를 하나도 못 읽고 전부 0이 된다(조용히 실패).
    2. **3D가 함께 들어 있는 경우** — 실제 배포본에는 `*_keypoints_2d`와
       `*_keypoints_3d`가 모두 있다. 3D는 미터 단위 실좌표라 브라우저 MediaPipe의
       z와 성격이 맞으므로 기본으로 3D를 쓴다.

    Returns:
        (pose, left, right, is_3d)
    """
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)

    holder = data
    people = data.get("people") if isinstance(data, dict) else None
    if isinstance(people, dict):
        holder = people
    elif isinstance(people, list) and people:
        # 여러 명이 잡히면 포즈 신뢰도 합이 가장 큰 사람을 수어자로 본다.
        holder = max(
            people, key=lambda p: float(np.sum(np.asarray(p.get("pose_keypoints_2d", [0]))[2::3]))
        )

    suffixes = ("_3d", "_2d") if prefer_3d else ("_2d", "_3d")
    for suffix in suffixes:
        pose = holder.get(f"pose_keypoints{suffix}")
        if not pose:
            continue
        return (
            pose,
            holder.get(f"hand_left_keypoints{suffix}") or [],
            holder.get(f"hand_right_keypoints{suffix}") or [],
            suffix == "_3d",
        )
    return [], [], [], False


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
    stem: str,
    morpheme_path: Path,
    keypoint_paths: list[Path],
    out_dir: Path,
    fps: float,
    prefer_3d: bool = True,
) -> dict | None:
    if not keypoint_paths:
        return None

    poses, lefts, rights = [], [], []
    is_3d = False
    for path in keypoint_paths:
        pose, left, right, frame_is_3d = read_openpose_json(path, prefer_3d=prefer_3d)
        poses.append(pose)
        lefts.append(left)
        rights.append(right)
        is_3d = is_3d or frame_is_3d

    def stack(rows: list, num_points: int) -> tuple[np.ndarray, np.ndarray]:
        """프레임별 평탄 배열들을 (T, N, 3) 좌표 + (T, N) 신뢰도로 모은다."""
        coords = np.zeros((len(rows), num_points, 3), dtype=np.float32)
        confs = np.zeros((len(rows), num_points), dtype=np.float32)
        for index, row in enumerate(rows):
            if not row:
                continue
            point, conf = split_keypoints(row, num_points)
            coords[index] = point[0]
            confs[index] = conf[0]
        return coords, confs

    pose_xyz, pose_conf = stack(poses, NUM_POSE_OP)
    left_xyz, left_conf = stack(lefts, NUM_HAND_OP)
    right_xyz, right_conf = stack(rights, NUM_HAND_OP)

    if is_3d:
        # 3D는 미터 단위 실좌표. convert_clip_3d의 위생 검사(중앙값 상대 기준)를 거친다.
        arrays, _ = convert_clip_3d(
            {
                "pose": pose_xyz.reshape(len(pose_xyz), -1),
                "hand_left": left_xyz.reshape(len(left_xyz), -1),
                "hand_right": right_xyz.reshape(len(right_xyz), -1),
            }
        )
    else:
        # 2D는 (x, y, conf) 형태로 되돌려 기존 경로를 태운다.
        def to_flat(coords: np.ndarray, conf: np.ndarray) -> np.ndarray:
            out = np.concatenate([coords[:, :, :2], conf[:, :, None]], axis=2)
            return out.reshape(len(coords), -1)

        arrays = convert_clip(
            {
                "pose": to_flat(pose_xyz, pose_conf),
                "hand_left": to_flat(left_xyz, left_conf),
                "hand_right": to_flat(right_xyz, right_conf),
            }
        )

    korean, glosses = read_morpheme(morpheme_path) if morpheme_path else ("", [])
    parsed = parse_clip_name(stem)

    source = "aihub-sl-3d" if is_3d else "aihub-sl-2d"
    meta = {
        "id": stem,
        "fps": fps,
        "korean_text": korean,
        "glosses": glosses,
        "source": source,
        "has_depth": is_3d,
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
        "source": source,
        "has_depth": is_3d,
        "angle": parsed.angle if parsed else "",
        "content_id": parsed.content_id if parsed else "",
        "kind": parsed.kind if parsed else "",
    }


def _worker(payload: tuple) -> dict | None:
    stem, morpheme_path, keypoint_paths, out_dir, fps, prefer_3d = payload
    try:
        return convert_clip_files(stem, morpheme_path, keypoint_paths, out_dir, fps, prefer_3d)
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
    parser.add_argument(
        "--force-2d",
        action="store_true",
        help="3D가 있어도 2D를 쓴다(학습·추론 모두 --zero-depth로 맞출 때)",
    )
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
        payloads.append((stem, morpheme_index.get(stem), paths, args.out, args.fps, not args.force_2d))

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
    depth_count = sum(1 for r in records if r["has_depth"])
    print(f"[etl] 수어자 {len(signers)}명 · 각도 {sorted(angles_seen)} · 깊이(z) 포함 {depth_count}개")
    if no_gloss:
        print(
            f"[etl] ⚠️ 글로스가 없는 클립 {no_gloss}개 — 형태소 zip을 함께 받았는지 확인하세요"
            " (형태소는 전부 합쳐도 0.2GB 남짓입니다)."
        )
    print("[etl] 다음: python -m ml.etl.prepare --data", args.out, "--split-by signer")


if __name__ == "__main__":
    main()

"""AI Hub 키포인트 라벨 → 학습용 랜드마크 팩(.npz) + index.jsonl.

지원 입력 형식
  repo         이 저장소의 `public/data/sign_N.json` 형식(검증됨).
               {korean_text, fps, num_frames, gloss_sequence[], keypoints{pose,hand_left,hand_right}}
  openpose-dir 클립마다 OpenPose 프레임별 JSON이 담긴 디렉터리 +
               글로스 타임코드가 든 라벨 JSON. AI Hub가 흔히 배포하는 형태다.
               (`*_000000000000_keypoints.json`, `people[0].pose_keypoints_2d` …)

  실행 예:
    python -m ml.etl.aihub_to_packs --format repo \
        --input public/data --out /data/signbridge/ksl-disaster

    python -m ml.etl.aihub_to_packs --format openpose-dir \
        --input /data/aihub/원천데이터 --labels /data/aihub/라벨링데이터 \
        --out /data/signbridge/ksl-full --workers 16

⚠️ 이 경로는 **2D OpenPose**를 쓰므로 깊이(z)가 없다. 학습·추론 모두
`zero_depth: true`로 맞추거나, 원본 영상이 있다면 `extract_mediapipe.py`를 쓰는 편이
정확도에서 유리하다(README의 "도메인 갭" 절 참고).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ml.signbridge.openpose import convert_clip, convert_clip_3d, unflatten  # noqa: E402
from ml.signbridge.pack import save_pack  # noqa: E402

FRAME_INDEX_RE = re.compile(r"(\d{6,})_keypoints\.json$")

# 3D 키포인트를 채택하려면 이 비율 이상의 프레임이 위생 검사를 통과해야 한다.
MIN_DEPTH_FRAME_RATIO = 0.7


# ──────────────────────────────────────────────────────────────────────────
# 형식 1: 이 저장소의 sign_N.json
# ──────────────────────────────────────────────────────────────────────────
def convert_repo_clip(json_path: Path, out_dir: Path, depth: str = "auto") -> dict | None:
    with open(json_path, encoding="utf-8") as handle:
        raw = json.load(handle)

    keypoints = raw.get("keypoints")
    if not keypoints or not keypoints.get("pose"):
        return None

    # 3D 키포인트가 있으면 우선 사용한다 — 깊이(z)가 실제로 채워져 브라우저의
    # MediaPipe 입력과 특징 공간이 맞는다. 유효 프레임 비율이 낮으면 2D로 되돌린다.
    keypoints3d = raw.get("keypoints3d")
    depth_ratio = 0.0
    has_depth = False
    if depth == "auto" and keypoints3d and keypoints3d.get("pose"):
        arrays_3d, frame_ok = convert_clip_3d(keypoints3d)
        depth_ratio = float(np.mean(frame_ok)) if len(frame_ok) else 0.0
        if depth_ratio >= MIN_DEPTH_FRAME_RATIO:
            arrays = arrays_3d
            has_depth = True
        else:
            arrays = convert_clip(keypoints)
    else:
        arrays = convert_clip(keypoints)

    clip_id = json_path.stem
    fps = float(raw.get("fps", 30.0))
    glosses = [
        {"gloss": g["gloss"], "start": float(g["start"]), "end": float(g["end"])}
        for g in raw.get("gloss_sequence", [])
    ]
    source = "aihub-openpose-3d" if has_depth else "aihub-openpose-2d"
    meta = {
        "id": clip_id,
        "fps": fps,
        "korean_text": raw.get("korean_text", ""),
        "glosses": glosses,
        "source": source,
        "has_depth": has_depth,
    }
    rel = f"packs/{clip_id}.npz"
    save_pack(out_dir / rel, arrays, meta)

    return {
        "id": clip_id,
        "npz": rel,
        "fps": fps,
        "num_frames": int(arrays["pose"].shape[0]),
        "korean_text": meta["korean_text"],
        "glosses": glosses,
        "signer": raw.get("signer", ""),
        "source": source,
        "has_depth": has_depth,
        "depth_frame_ratio": round(depth_ratio, 4),
    }


# ──────────────────────────────────────────────────────────────────────────
# 형식 2: OpenPose 프레임별 JSON 디렉터리
# ──────────────────────────────────────────────────────────────────────────
def read_openpose_frame(path: Path) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """OpenPose 한 프레임 JSON → (pose 25×3, left 21×3, right 21×3)."""
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    people = data.get("people") or []
    if not people:
        return (
            np.zeros((25, 3), dtype=np.float32),
            np.zeros((21, 3), dtype=np.float32),
            np.zeros((21, 3), dtype=np.float32),
        )
    # 여러 명이 잡히면 포즈 신뢰도 합이 가장 큰 사람을 수어자로 본다.
    person = max(people, key=lambda p: float(np.sum(p.get("pose_keypoints_2d", [0])[2::3])))
    pose = unflatten(person.get("pose_keypoints_2d", []), 25)[0]
    left = unflatten(person.get("hand_left_keypoints_2d", []), 21)[0]
    right = unflatten(person.get("hand_right_keypoints_2d", []), 21)[0]
    return pose, left, right


def load_label(labels_dir: Path, clip_id: str) -> dict:
    """클립 ID에 대응하는 라벨 JSON을 찾아 글로스 타임코드를 뽑아낸다.

    AI Hub 라벨 스키마가 배포마다 달라, 알려진 필드 이름을 순서대로 시도한다.
    맞는 게 없으면 빈 글로스를 반환하고 상위에서 경고한다.
    """
    candidates = list(labels_dir.rglob(f"{clip_id}*.json"))
    if not candidates:
        return {"korean_text": "", "glosses": []}

    with open(candidates[0], encoding="utf-8") as handle:
        raw = json.load(handle)

    korean_text = ""
    for key in ("korean_text", "korean", "sentence", "text", "korean_sentence"):
        if isinstance(raw.get(key), str) and raw[key]:
            korean_text = raw[key]
            break

    entries = None
    for key in ("gloss_sequence", "sign_script", "data", "annotations", "morpheme"):
        value = raw.get(key)
        if isinstance(value, list) and value:
            entries = value
            break
    if entries is None:
        return {"korean_text": korean_text, "glosses": []}

    glosses: list[dict] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        gloss = next(
            (
                entry[key]
                for key in ("gloss", "name", "attribute_name", "sign", "text")
                if isinstance(entry.get(key), str)
            ),
            None,
        )
        start = next(
            (entry[key] for key in ("start", "start_time", "begin") if key in entry), None
        )
        end = next((entry[key] for key in ("end", "end_time", "finish") if key in entry), None)
        if gloss is None or start is None or end is None:
            continue
        glosses.append({"gloss": gloss, "start": float(start), "end": float(end)})

    return {"korean_text": korean_text, "glosses": glosses}


def convert_openpose_clip(clip_dir: Path, labels_dir: Path, out_dir: Path, fps: float) -> dict | None:
    frame_files = sorted(
        (p for p in clip_dir.glob("*_keypoints.json")),
        key=lambda p: int(FRAME_INDEX_RE.search(p.name).group(1))
        if FRAME_INDEX_RE.search(p.name)
        else 0,
    )
    if not frame_files:
        return None

    poses, lefts, rights = [], [], []
    for frame_file in frame_files:
        pose, left, right = read_openpose_frame(frame_file)
        poses.append(pose)
        lefts.append(left)
        rights.append(right)

    keypoints = {
        "pose": np.stack(poses).reshape(len(poses), -1),
        "hand_left": np.stack(lefts).reshape(len(lefts), -1),
        "hand_right": np.stack(rights).reshape(len(rights), -1),
    }
    arrays = convert_clip(keypoints)

    clip_id = clip_dir.name
    label = load_label(labels_dir, clip_id) if labels_dir else {"korean_text": "", "glosses": []}
    meta = {
        "id": clip_id,
        "fps": fps,
        "korean_text": label["korean_text"],
        "glosses": label["glosses"],
        "source": "aihub-openpose-2d",
    }
    rel = f"packs/{clip_id}.npz"
    save_pack(out_dir / rel, arrays, meta)

    return {
        "id": clip_id,
        "npz": rel,
        "fps": fps,
        "num_frames": len(frame_files),
        "korean_text": label["korean_text"],
        "glosses": label["glosses"],
        "signer": "",
        "source": meta["source"],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="AI Hub 키포인트 → 랜드마크 팩")
    parser.add_argument("--format", choices=["repo", "openpose-dir"], required=True)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--labels", type=Path, default=None, help="openpose-dir 형식의 라벨 디렉터리")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--fps", type=float, default=30.0, help="openpose-dir에서 쓸 기본 fps")
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--limit", type=int, default=0, help="0이 아니면 앞의 N개만 처리(시험용)")
    parser.add_argument(
        "--depth",
        choices=["auto", "off"],
        default="auto",
        help="auto=keypoints3d가 있으면 깊이까지 사용, off=2D만 사용",
    )
    args = parser.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)

    if args.format == "repo":
        tasks = sorted(p for p in args.input.glob("sign_*.json"))
        worker = convert_repo_clip
        arguments = [(path, args.out, args.depth) for path in tasks]
    else:
        tasks = sorted(p for p in args.input.iterdir() if p.is_dir())
        worker = convert_openpose_clip
        arguments = [(path, args.labels, args.out, args.fps) for path in tasks]

    if args.limit:
        arguments = arguments[: args.limit]
    if not arguments:
        raise SystemExit(f"처리할 클립이 없습니다: {args.input}")

    print(f"[etl] {len(arguments)}개 클립 변환 시작 (workers={args.workers})")
    records: list[dict] = []
    no_gloss = 0

    if args.workers <= 1:
        for argument in arguments:
            record = worker(*argument)
            if record:
                records.append(record)
    else:
        with ProcessPoolExecutor(max_workers=args.workers) as pool:
            futures = {pool.submit(worker, *argument): argument for argument in arguments}
            for index, future in enumerate(as_completed(futures), start=1):
                try:
                    record = future.result()
                except Exception as error:  # 한 클립 실패로 전체가 죽지 않게.
                    print(f"  [warn] {futures[future][0].name}: {error}")
                    continue
                if record:
                    records.append(record)
                if index % 200 == 0:
                    print(f"  {index}/{len(arguments)}")

    records.sort(key=lambda r: r["id"])
    for record in records:
        if not record["glosses"]:
            no_gloss += 1

    index_path = args.out / "index.jsonl"
    with open(index_path, "w", encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")

    total_glosses = sum(len(r["glosses"]) for r in records)
    with_depth = sum(1 for r in records if r.get("has_depth"))
    print(f"[etl] 완료: 클립 {len(records)}개, 글로스 구간 {total_glosses}개 → {index_path}")
    if args.format == "repo":
        print(f"[etl] 깊이(z) 포함 클립 {with_depth}/{len(records)}개")
        if 0 < with_depth < len(records):
            print(
                "[etl] ⚠️ 2D 클립과 3D 클립이 섞여 있습니다. 특징의 z 채널이 클립마다 달라져"
                " 학습이 불안정할 수 있으니, 학습 시 --zero-depth로 통일하거나 3D 클립만"
                " 골라 쓰세요."
            )
    if no_gloss:
        print(
            f"[etl] ⚠️ 글로스 타임코드가 없는 클립 {no_gloss}개. 라벨 스키마가 다를 수 있으니"
            f" `python -m ml.etl.inspect_json {args.labels or args.input}`로 확인하세요."
        )


if __name__ == "__main__":
    main()

"""원본 수어 **영상** → MediaPipe 랜드마크 팩(.npz).  ★ 권장 경로

왜 OpenPose 라벨을 그냥 쓰지 않고 재추출하는가
────────────────────────────────────────────
브라우저 추론은 MediaPipe Holistic으로 랜드마크를 뽑는다. AI Hub가 제공하는 OpenPose
키포인트로 학습하면 **학습 분포 ≠ 추론 분포**가 되어, 검증 정확도는 높은데 실제 웹캠에서는
동작하지 않는 전형적인 실패에 빠진다. 차이는 세 군데서 온다.

  1. 깊이(z): OpenPose 2D 라벨에는 없고 MediaPipe에는 있다(155차원 중 51개 채널).
  2. 관절 정의: 어깨·손목 지점이 미묘하게 다르고, 손 검출 실패 패턴도 다르다.
  3. 지터 특성: 검출기마다 프레임 간 흔들림의 성격이 다르다.

원본 영상이 있으면 재추출이 **정답**이다. 없을 때만 `aihub_to_packs.py`를 쓴다.

비용: MediaPipe는 CPU 추론이라 영상 길이에 비례한다. 16 vCPU 워크스페이스에서
워커 14개 기준 대략 실시간의 20~30배속(= 1시간 분량 영상을 2~3분)이 나온다.
GPU는 이 단계에서 거의 쓰이지 않으므로 CPU 워크스페이스가 있으면 그쪽에서 돌리는 게 좋다.
다만 KOREN GPU 워크스페이스에도 vCPU 16이 함께 붙어 나오므로, **CPU 자원이 따로 없으면
GPU 워크스페이스에서 그냥 돌려도 속도는 같다**(GPU가 노는 것이 유일한 손해).

    python -m ml.etl.extract_mediapipe \
        --videos /data/aihub/원천데이터 --labels /data/aihub/라벨링데이터 \
        --out /data/signbridge/ksl-mp --workers 14 --every 1
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ml.etl.aihub_to_packs import load_label  # noqa: E402
from ml.signbridge.pack import save_pack  # noqa: E402

VIDEO_SUFFIXES = {".mp4", ".avi", ".mov", ".mkv", ".mts", ".webm"}
NUM_POSE_POINTS = 33
NUM_HAND_POINTS = 21

# 워커 프로세스마다 하나씩 만들어 재사용한다(모델 로드가 비싸다).
_HOLISTIC = None


def get_holistic():
    global _HOLISTIC
    if _HOLISTIC is None:
        import mediapipe as mp

        _HOLISTIC = mp.solutions.holistic.Holistic(
            static_image_mode=False,
            model_complexity=1,  # 0=빠름/부정확, 2=느림. 1이 수어에서 균형점.
            smooth_landmarks=True,
            refine_face_landmarks=False,  # 얼굴 상세는 155차원 특징에 안 쓰인다.
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )
    return _HOLISTIC


def landmarks_to_array(landmark_list, num_points: int) -> tuple[np.ndarray, bool]:
    if landmark_list is None:
        return np.zeros((num_points, 3), dtype=np.float32), False
    points = np.array(
        [[lm.x, lm.y, lm.z] for lm in landmark_list.landmark], dtype=np.float32
    )
    if points.shape[0] != num_points:
        return np.zeros((num_points, 3), dtype=np.float32), False
    return points, True


def extract_video(
    video_path: Path, out_dir: Path, labels_dir: Path | None, every: int, max_frames: int
) -> dict | None:
    import cv2

    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        return None

    source_fps = capture.get(cv2.CAP_PROP_FPS) or 30.0
    holistic = get_holistic()

    poses, pose_confs, lefts, rights = [], [], [], []
    left_present, right_present, pose_detected = [], [], []
    frame_index = 0
    kept = 0

    while True:
        ok, frame = capture.read()
        if not ok:
            break
        if every > 1 and frame_index % every != 0:
            frame_index += 1
            continue

        result = holistic.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))

        pose, has_pose = landmarks_to_array(result.pose_landmarks, NUM_POSE_POINTS)
        confidence = (
            np.array([lm.visibility for lm in result.pose_landmarks.landmark], dtype=np.float32)
            if has_pose
            else np.zeros(NUM_POSE_POINTS, dtype=np.float32)
        )
        left, has_left = landmarks_to_array(result.left_hand_landmarks, NUM_HAND_POINTS)
        right, has_right = landmarks_to_array(result.right_hand_landmarks, NUM_HAND_POINTS)

        poses.append(pose)
        pose_confs.append(confidence)
        pose_detected.append(has_pose)
        lefts.append(left)
        rights.append(right)
        left_present.append(has_left)
        right_present.append(has_right)

        frame_index += 1
        kept += 1
        if max_frames and kept >= max_frames:
            break

    capture.release()
    if kept == 0:
        return None

    pose_stack = np.stack(poses)
    arrays = {
        "pose": pose_stack,
        "pose_conf": np.stack(pose_confs),
        # MediaPipe는 포즈가 잡힌 프레임에서 항상 33점 전부를 반환한다(가시성이 낮아도
        # 좌표는 준다). 브라우저도 그 값을 그대로 쓰므로 여기서 가시성으로 걸러내면
        # 오히려 학습·추론이 어긋난다 → 프레임 단위로만 존재 여부를 표시한다.
        "pose_present": np.repeat(
            np.array(pose_detected, dtype=bool)[:, None], NUM_POSE_POINTS, axis=1
        ),
        "left": np.stack(lefts),
        "right": np.stack(rights),
        "left_present": np.array(left_present, dtype=bool),
        "right_present": np.array(right_present, dtype=bool),
    }

    clip_id = video_path.stem
    effective_fps = source_fps / max(1, every)
    label = (
        load_label(labels_dir, clip_id) if labels_dir else {"korean_text": "", "glosses": []}
    )
    meta = {
        "id": clip_id,
        "fps": effective_fps,
        "korean_text": label["korean_text"],
        "glosses": label["glosses"],
        "source": "mediapipe-holistic",
    }
    rel = f"packs/{clip_id}.npz"
    save_pack(out_dir / rel, arrays, meta)

    hand_rate = float(np.mean(np.asarray(left_present) | np.asarray(right_present)))
    return {
        "id": clip_id,
        "npz": rel,
        "fps": effective_fps,
        "num_frames": kept,
        "korean_text": label["korean_text"],
        "glosses": label["glosses"],
        "signer": "",
        "source": meta["source"],
        "hand_detect_rate": round(hand_rate, 4),
    }


def _worker(payload: tuple) -> dict | None:
    video_path, out_dir, labels_dir, every, max_frames = payload
    try:
        return extract_video(video_path, out_dir, labels_dir, every, max_frames)
    except Exception as error:
        print(f"  [warn] {video_path.name}: {error}", flush=True)
        return None


def main() -> None:
    parser = argparse.ArgumentParser(description="수어 영상 → MediaPipe 랜드마크 팩")
    parser.add_argument("--videos", type=Path, required=True)
    parser.add_argument("--labels", type=Path, default=None)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 4) - 2))
    parser.add_argument("--every", type=int, default=1, help="N프레임마다 1장(다운샘플)")
    parser.add_argument("--max-frames", type=int, default=0, help="클립당 최대 프레임(0=제한 없음)")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--resume", action="store_true", help="이미 팩이 있는 클립은 건너뛴다")
    args = parser.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)
    videos = sorted(p for p in args.videos.rglob("*") if p.suffix.lower() in VIDEO_SUFFIXES)
    if args.resume:
        videos = [v for v in videos if not (args.out / "packs" / f"{v.stem}.npz").exists()]
    if args.limit:
        videos = videos[: args.limit]
    if not videos:
        raise SystemExit(f"영상이 없습니다(또는 모두 처리됨): {args.videos}")

    print(f"[etl] 영상 {len(videos)}개 → MediaPipe 추출 (workers={args.workers})")
    payloads = [(v, args.out, args.labels, args.every, args.max_frames) for v in videos]
    records: list[dict] = []

    if args.workers <= 1:
        for index, payload in enumerate(payloads, start=1):
            record = _worker(payload)
            if record:
                records.append(record)
            if index % 50 == 0:
                print(f"  {index}/{len(payloads)}", flush=True)
    else:
        # spawn: MediaPipe는 fork 후 재사용 시 불안정할 수 있다.
        import multiprocessing as multiprocessing_module

        context = multiprocessing_module.get_context("spawn")
        with context.Pool(processes=args.workers) as pool:
            for index, record in enumerate(pool.imap_unordered(_worker, payloads, chunksize=1), 1):
                if record:
                    records.append(record)
                if index % 50 == 0:
                    print(f"  {index}/{len(payloads)}", flush=True)

    records.sort(key=lambda r: r["id"])
    index_path = args.out / "index.jsonl"
    mode = "a" if args.resume and index_path.exists() else "w"
    with open(index_path, mode, encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")

    if records:
        mean_hand = float(np.mean([r["hand_detect_rate"] for r in records]))
        print(f"[etl] 완료: 클립 {len(records)}개 → {index_path}")
        print(f"[etl] 평균 손 검출률 {mean_hand:.1%} (0.7 미만이면 화질·크롭·조명 점검)")


if __name__ == "__main__":
    main()

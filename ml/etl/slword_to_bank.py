"""수어영상 WORD 클립을 글로스 동작 사전(bank)에 편입한다.

    python -m ml.etl.slword_to_bank \
        --index ~/sbdata/ksl-slword/index.jsonl \
        --kp ~/sbdata/raw/sl-word-kp-x \
        --bank ~/sbdata/glossbank

재난안전 뱅크(23,035종)는 재난 어휘 중심이라 "고민"·"약국" 같은 **일상 낱말**이
비어 있다. 수어영상 WORD는 클립 하나가 낱말 하나의 정석 실연이라 뱅크 재료로
이상적이다. 이미 변환된 팩의 index.jsonl에서 글로스·구간·수어자를 읽고,
아바타 리타게팅용 OpenPose 원시 좌표는 **원본 프레임 JSON에서 다시** 뽑는다
(팩은 MediaPipe 33점으로 변환돼 25점을 복원할 수 없다 — build_gloss_bank와 같은 이유).

기존 뱅크와 형식·점수 기준을 완전히 같게 맞춰 병합한다. 같은 글로스가 이미 있으면
점수가 높은 쪽이 남는다(WORD는 스튜디오 정석 실연이라 대체로 이긴다).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ml.etl.aihub_sl import NUM_HAND_OP, NUM_POSE_OP, read_openpose_json  # noqa: E402
from ml.etl.build_gloss_bank import (  # noqa: E402
    MIN_FRAMES,
    PAD_SEC,
    safe_name,
    sane_3d,
    score_segment,
)
from ml.signbridge.openpose import split_keypoints  # noqa: E402
from ml.signbridge.vocab import normalize_gloss  # noqa: E402


def load_frames(clip_dir: Path) -> tuple[np.ndarray, ...] | None:
    """프레임별 OpenPose JSON을 뱅크 형식 평탄 배열로 모은다.

    반환: (pose2, left2, right2, pose3, left3, right3, is_3d)
      - *2  : (T, N*3) — (x, y, conf). 뱅크의 2D 형식.
      - *3  : (T, N*3) — (x, y, z). 3D 클립일 때만 의미가 있다.
    split_keypoints가 stride(2D=3값, 3D=4값)를 자동 판별해 좌표와 신뢰도를
    따로 돌려주므로, 여기서 두 형식으로 다시 조립한다.
    """
    paths = sorted(clip_dir.glob("*_keypoints.json"))
    if len(paths) < MIN_FRAMES:
        return None
    rows = []
    is_3d = False
    for p in paths:
        pose, left, right, frame_3d = read_openpose_json(p, prefer_3d=True)
        rows.append((pose, left, right))
        is_3d = is_3d or frame_3d

    def stack(idx: int, n: int) -> tuple[np.ndarray, np.ndarray]:
        flat2 = np.zeros((len(rows), n * 3), dtype=np.float32)
        flat3 = np.zeros((len(rows), n * 3), dtype=np.float32)
        for i, row in enumerate(rows):
            if not row[idx]:
                continue
            coords, conf = split_keypoints(row[idx], n)
            # 2D 형식: (x, y, conf)
            flat2[i] = np.concatenate(
                [coords[0, :, :2], conf[0][:, None]], axis=1).reshape(-1)
            # 3D 형식: (x, y, z) — 2D 클립이면 z가 0이라 안 쓰인다.
            flat3[i] = coords[0].reshape(-1)
        return flat2, flat3

    p2, p3 = stack(0, NUM_POSE_OP)
    l2, l3 = stack(1, NUM_HAND_OP)
    r2, r3 = stack(2, NUM_HAND_OP)
    return p2, l2, r2, p3, l3, r3, is_3d


def main() -> None:
    parser = argparse.ArgumentParser(description="수어영상 WORD → 글로스 뱅크 편입")
    parser.add_argument("--index", type=Path, required=True, help="ksl-slword/index.jsonl")
    parser.add_argument("--kp", type=Path, required=True, help="키포인트 해제 루트(sl-word-kp-x)")
    parser.add_argument("--bank", type=Path, required=True, help="기존 뱅크 디렉터리(병합 대상)")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    index_path = args.bank / "bank.json"
    index: dict[str, dict] = json.loads(index_path.read_text(encoding="utf-8"))
    gloss_dir = args.bank / "glosses"
    print(f"[slbank] 기존 뱅크 {len(index):,}종")

    # 클립 디렉터리 위치를 한 번만 색인한다 (01/02/03/05 하위에 흩어져 있다).
    clip_dirs: dict[str, Path] = {}
    for sub in sorted(args.kp.iterdir()):
        if not sub.is_dir():
            continue
        for d in sub.iterdir():
            if d.is_dir():
                clip_dirs[d.name] = d
    print(f"[slbank] 키포인트 클립 {len(clip_dirs):,}개 색인")

    done = added = replaced = skipped = 0
    for line in open(args.index, encoding="utf-8"):
        if args.limit and done >= args.limit:
            break
        rec = json.loads(line)
        clip_dir = clip_dirs.get(rec["id"])
        if clip_dir is None:
            continue
        glosses = rec.get("glosses") or []
        if not glosses:
            continue
        gloss = normalize_gloss(glosses[0].get("gloss", ""))
        if not gloss:
            continue
        done += 1

        fps = float(rec.get("fps") or 30.0)
        span = glosses[0]
        duration = float(span["end"]) - float(span["start"])

        frames = load_frames(clip_dir)
        if frames is None:
            skipped += 1
            continue
        pose, left, right, pose3, left3, right3, is_3d = frames
        if not is_3d:
            pose3 = left3 = right3 = None
        total = len(pose)
        start = max(0, int((float(span["start"]) - PAD_SEC) * fps))
        end = min(total, int((float(span["end"]) + PAD_SEC) * fps))
        if end - start < MIN_FRAMES:
            skipped += 1
            continue

        seg_pose3 = pose3[start:end] if pose3 is not None else None
        has_3d = sane_3d(seg_pose3)
        # WORD는 전부 스튜디오 정석 실연(augment 없음).
        score = score_segment(pose[start:end], left[start:end], right[start:end],
                              duration, augment=False, studio=True, has_3d=has_3d)
        prior = index.get(gloss)
        if prior is not None and prior["score"] >= score:
            continue

        # 수어영상 3D는 **미터 단위**다(값이 ±3 안쪽). 재난안전처럼 소수 1자리로
        # 반올림하면 0.1m 해상도가 되어 손 동작이 통째로 뭉개진다 — 좌표 크기를
        # 보고 자릿수를 정한다(픽셀·mm는 1자리, 미터는 4자리).
        scale = float(np.median(np.abs(pose[start:end][pose[start:end] != 0.0]))) if np.any(pose[start:end]) else 0.0
        digits = 4 if scale < 10.0 else 1

        def round_list(arr: np.ndarray | None, width: int) -> list[list[float]]:
            if arr is None:
                return [[0.0] * width for _ in range(end - start)]
            return np.round(arr[start:end, :width].astype(float), digits).tolist()

        data = {
            "korean_text": gloss,
            "fps": fps,
            "num_frames": end - start,
            "gloss_sequence": [{"gloss": gloss, "start": 0.0,
                                "end": round((end - start) / fps, 3)}],
            "keypoints": {
                "pose": round_list(pose, 75),
                "hand_left": round_list(left, 63),
                "hand_right": round_list(right, 63),
            },
            "source_clip": rec["id"],
        }
        if has_3d:
            data["keypoints3d"] = {
                "pose": round_list(pose3, 75),
                "hand_left": round_list(left3, 63),
                "hand_right": round_list(right3, 63),
            }

        fname = f"{safe_name(gloss)}.json"
        (gloss_dir / fname).write_text(
            json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        if prior is None:
            added += 1
        else:
            replaced += 1
        index[gloss] = {
            "file": fname,
            "frames": data["num_frames"],
            "fps": fps,
            "score": round(score, 3),
            "has3d": has_3d,
        }
        if done % 500 == 0:
            print(f"  [slbank] {done:,}클립 · 신규 {added:,} · 교체 {replaced:,}", flush=True)

    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[slbank] 완료 — 클립 {done:,} · 신규 {added:,} · 교체 {replaced:,} · 건너뜀 {skipped:,}")
    print(f"[slbank] 뱅크 {len(index):,}종")


if __name__ == "__main__":
    main()

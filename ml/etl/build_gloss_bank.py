"""글로스 → 동작 사전(gloss bank) 구축 — "AI 아바타 번역"의 마지막 조각.

    python -m ml.etl.build_gloss_bank --input <형태소 zip> --out <뱅크 디렉터리>

text2gloss(KoBART)가 임의 문장을 글로스열로 바꿔도, 아바타에게 각 글로스의 **동작
데이터**가 없으면 움직일 수 없다. 이 스크립트는 형태소 JSON(원본 zip, 풀지 않음)을
한 번 훑으며 **글로스마다 가장 잘 찍힌 실연 구간 하나**를 골라, 프런트엔드가 그대로
재생할 수 있는 형식(`SignData`와 동일: OpenPose 원시 픽셀 좌표)으로 저장한다.

팩(ksl/packs)을 쓰지 않고 원본에서 다시 뽑는 이유: 팩은 브라우저 **인식**용으로
MediaPipe 33점으로 변환된 것이라(9관절만 대응) 아바타 리타게팅용 OpenPose 25점을
복원할 수 없다.

선정 기준(높을수록 좋음):
  - 실제 재난문자(augment=False) · 스튜디오 촬영 가점 — 동작이 정석에 가깝다
  - 양손 검출 신뢰도 평균 — 손이 안 잡힌 구간은 아바타 손이 무너진다
  - 길이 0.3~1.6초 적정 구간 가점 — 너무 짧으면 뚝 끊기고 길면 문장 맥락이 섞인 것
  - 구간 앞뒤 0.1초 여유 포함(전환 보간용)

출력:
  <out>/glosses/<글로스>.json     글로스 하나의 SignData(단일 gloss_sequence)
  <out>/bank.json                 글로스 → {file, frames, fps, score} 색인
저장은 정수 반올림 좌표(픽셀 단위 오차 0.5 이하)로 용량을 줄인다.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ml.etl.aihub_disaster import meta_get, read_glosses  # noqa: E402
from ml.signbridge.archive import find_archives, stream_archive  # noqa: E402
from ml.signbridge.vocab import normalize_gloss  # noqa: E402

PAD_SEC = 0.1
GOOD_LEN = (0.3, 1.6)
MIN_FRAMES = 6


def _flat(landmarks: dict, key: str) -> np.ndarray | None:
    raw = landmarks.get(key)
    if raw is None:
        return None
    arr = np.asarray(raw, dtype=np.float32)
    if arr.ndim == 3:
        arr = arr.reshape(arr.shape[0], -1)
    if arr.ndim == 1:
        arr = arr[None, :]
    return arr


def score_segment(pose: np.ndarray, left: np.ndarray, right: np.ndarray,
                  duration: float, augment: bool, studio: bool, has_3d: bool) -> float:
    # OpenPose 평탄 배열의 3번째 값마다가 confidence다.
    conf = 0.0
    for hand in (left, right):
        if hand is not None and hand.size:
            conf += float(np.mean(hand[:, 2::3]))
    score = conf  # 0~2
    if not augment:
        score += 0.5
    if studio:
        score += 0.25
    if GOOD_LEN[0] <= duration <= GOOD_LEN[1]:
        score += 0.5
    if has_3d:
        # 3D가 있으면 아바타 팔 동작의 깊이가 정확해진다(리타게팅이 keypoints3d 우선).
        score += 0.75
    return score


def sane_3d(pose3: np.ndarray | None) -> bool:
    """3D 구간의 정상성 검사 — 깊이 추정 실패 프레임(-25,000,000 따위)을 걸러낸다.

    좌표 단위가 배포본마다 제각각(mm·m)이라 절대 임계값 대신 중앙값 상대 기준을 쓴다.
    """
    if pose3 is None or pose3.size == 0:
        return False
    z = pose3[:, 2::3]
    z = z[np.isfinite(z)]
    if z.size == 0:
        return False
    med = float(np.median(np.abs(z))) or 1.0
    return bool(np.all(np.abs(z) < med * 50))


def safe_name(gloss: str) -> str:
    """글로스를 파일명으로 — 한글은 유지하되 **윈도우가 못 쓰는 문자는 남기지 않는다.**

    예전에는 `:`를 남겼다(`날짜:10월10일.json`). 웹에서는 아무 문제가 없어서
    오래 못 봤는데, **윈도우는 파일명에 `:`를 못 쓴다.** 두 가지로 터졌다:
      · 노트북용 zip을 풀면 1,365개에서 "0x80070057 매개 변수가 틀립니다"로 멈춘다
      · `git clone` 이 윈도우에서 checkout 자체를 통째로 실패한다
    건너뛰면 날짜·시각 수어가 통째로 빠진다 — 재난문자에 가장 자주 나오는 것들이다.

    `#`도 뺀다 — 브라우저 fetch URL에서 조각(fragment)으로 잘린다.
    이미 만들어 둔 사전과 이름이 달라지는 것은 `export_web_bank`가 흡수한다.

    금지 문자: 역슬래시 / : * ? " < > |  (윈도우)  ·  `#`(URL)
    """
    text = unicodedata.normalize("NFC", gloss)
    return re.sub(r"[^\w가-힣]+", "_", text)


def main() -> None:
    parser = argparse.ArgumentParser(description="글로스 → 동작 사전 구축")
    parser.add_argument("--input", type=Path, required=True, help="형태소 JSON zip·디렉터리")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--limit", type=int, default=0, help="JSON 몇 개만(시험용)")
    parser.add_argument("--merge-variants", action="store_true")
    args = parser.parse_args()

    best: dict[str, dict] = {}  # gloss → {score, data}
    seen = 0

    def handle(name: str, raw: bytes) -> None:
        nonlocal seen
        if args.limit and seen >= args.limit:
            return
        seen += 1
        try:
            record = json.loads(raw.decode("utf-8-sig"))
        except Exception:
            return
        if "sign_script" not in record and "landmarks" not in record:
            for value in record.values():
                if isinstance(value, dict) and "sign_script" in value:
                    record = value
                    break

        landmarks = record.get("landmarks") or {}
        pose = _flat(landmarks, "pose_keypoints_2d")
        left = _flat(landmarks, "hand_left_keypoints_2d")
        right = _flat(landmarks, "hand_right_keypoints_2d")
        # **2D와 3D는 배타적이다.** 3D 촬영본(전체의 약 59%)은 `*_keypoints_3d`만 있고
        # 2D 필드가 없다. 2D만 요구하면 3D본이 통째로 빠진다(실측으로 확인).
        pose3 = _flat(landmarks, "pose_keypoints_3d")
        left3 = _flat(landmarks, "hand_left_keypoints_3d")
        right3 = _flat(landmarks, "hand_right_keypoints_3d")

        if pose is None and pose3 is not None:
            # 3D 전용 클립: (x,y)를 2D 대용으로 쓴다(conf=1). 좌표계는 카메라 공간(mm)
            # 이지만 /compose가 어깨 기준으로 재정규화하므로 단위는 문제가 안 된다.
            def xy_of(arr3: np.ndarray | None) -> np.ndarray | None:
                if arr3 is None:
                    return None
                out = arr3.copy()
                # 미검출(전부 0) 점은 conf 0, 나머지는 1로.
                for i in range(out.shape[1] // 3):
                    xyz = out[:, i * 3 : i * 3 + 3]
                    alive = np.any(xyz != 0.0, axis=1)
                    out[:, i * 3 + 2] = alive.astype(np.float32)
                return out

            pose, left, right = xy_of(pose3), xy_of(left3), xy_of(right3)
        if pose is None or len(pose) < MIN_FRAMES:
            return

        fps = float(meta_get(record, "video_fps") or 30.0)
        augment = bool(meta_get(record, "augment", False))
        studio = bool(meta_get(record, "filmed_in_studio", True))
        total = len(pose)

        for entry in read_glosses(record, ["both", "strong", "weak"]):
            gloss = normalize_gloss(entry["gloss"], args.merge_variants)
            if not gloss:
                continue
            duration = entry["end"] - entry["start"]
            start = max(0, int((entry["start"] - PAD_SEC) * fps))
            end = min(total, int((entry["end"] + PAD_SEC) * fps))
            if end - start < MIN_FRAMES:
                continue
            seg_pose = pose[start:end]
            seg_left = left[start:end] if left is not None and len(left) >= end else None
            seg_right = right[start:end] if right is not None and len(right) >= end else None
            seg_pose3 = pose3[start:end] if pose3 is not None and len(pose3) >= end else None
            has_3d = sane_3d(seg_pose3)
            score = score_segment(seg_pose, seg_left, seg_right, duration, augment, studio, has_3d)
            prior = best.get(gloss)
            if prior is not None and prior["score"] >= score:
                continue

            def round_list(arr: np.ndarray | None, width: int, digits: int = 1) -> list[list[float]]:
                if arr is None:
                    return [[0.0] * width for _ in range(end - start)]
                return np.round(arr[:, :width].astype(float), digits).tolist()

            data = {
                "korean_text": gloss,
                "fps": fps,
                "num_frames": end - start,
                "gloss_sequence": [
                    {"gloss": gloss, "start": 0.0,
                     "end": round((end - start) / fps, 3)}
                ],
                "keypoints": {
                    "pose": round_list(seg_pose, 75),
                    "hand_left": round_list(seg_left, 63),
                    "hand_right": round_list(seg_right, 63),
                },
                "source_clip": str(meta_get(record, "id") or ""),
            }
            if has_3d:
                seg_left3 = left3[start:end] if left3 is not None and len(left3) >= end else None
                seg_right3 = right3[start:end] if right3 is not None and len(right3) >= end else None
                data["keypoints3d"] = {
                    "pose": round_list(seg_pose3, 75),
                    "hand_left": round_list(seg_left3, 63),
                    "hand_right": round_list(seg_right3, 63),
                }
            best[gloss] = {"score": score, "data": data}
        if seen % 2000 == 0:
            print(f"  [bank] JSON {seen:,}개 훑음 · 글로스 {len(best):,}종 확보", flush=True)

    archives = find_archives(args.input)
    if archives:
        for archive in archives:
            print(f"[bank] 스트리밍: {archive.name}")
            stream_archive(archive, (".json",), handle)
    else:
        for path in sorted(args.input.rglob("*.json")):
            handle(str(path), path.read_bytes())

    gloss_dir = args.out / "glosses"
    gloss_dir.mkdir(parents=True, exist_ok=True)
    index: dict[str, dict] = {}
    for gloss, item in sorted(best.items()):
        fname = f"{safe_name(gloss)}.json"
        (gloss_dir / fname).write_text(
            json.dumps(item["data"], ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        index[gloss] = {
            "file": fname,
            "frames": item["data"]["num_frames"],
            "fps": item["data"]["fps"],
            "score": round(item["score"], 3),
            "has3d": "keypoints3d" in item["data"],
        }
    (args.out / "bank.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    total_mb = sum(f.stat().st_size for f in gloss_dir.glob("*.json")) / 1e6
    print(f"\n[bank] 글로스 {len(index):,}종 → {args.out} ({total_mb:.0f} MB)")


if __name__ == "__main__":
    main()

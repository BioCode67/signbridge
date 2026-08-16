"""AI Hub「재난안전정보 수어영상 데이터」형태소/비수지 JSON → 랜드마크 팩.

**이 어댑터는 추측이 아니라 공식 구축 가이드라인(V1.1)의 스키마 표를 근거로 작성했다.**

    python -m ml.etl.aihub_disaster --input /data/raw/재난안전/라벨링데이터 \
        --out /data/signbridge/ksl-disaster --workers 16

────────────────────────────────────────────────────────────────────────────
확인된 JSON 스키마 (재난안전 수어영상데이터셋 구축 가이드라인 V1.1)
────────────────────────────────────────────────────────────────────────────
    id                문자열. 파일명 = 프로젝트·그룹·카테고리·번호·1:1~1:3 번역정보
                      ·촬영소·촬영자 정보
    korean_text       한국어 원문 (필수)
    video_fps         30
    signer            수연가(수어 연기자) 정보  ← **수어자 분리 평가의 근거**
    editor / annotator / translator   검수자·가공자·번역가
    augment           true = AI 증강 문장, false = 실제 발송된 재난문자
    filmed_in_studio  true = 대면(스튜디오) 촬영, false = 비대면 촬영
    hand_default      우세손
    landmarks         camera_parameter{Rotation, Translation, intrinsic_F/L,
                                       Fprojectionmatrix, Lprojectionmatrix}
                      pose_keypoints_3d / hand_left_keypoints_3d
                      hand_right_keypoints_3d / face_keypoints_3d
    sign_script       sign_gestures_both   (필수, 양손)
                      sign_gestures_strong (우세손)
                      sign_gestures_weak   (비우세손)
                        └ 각 항목: start, end, gloss_id, express(수지/지수어),
                                   position[{start,end,zone}], direction{source,target},
                                   sentence_loc{start,end}
    nms_script        비수지 요소 Ci/Hs/EBf/Hno/Mmo/Mo1/Tbt/Mctr — 각 {start,end,descriptor}

주의할 점 세 가지
  1. **글로스가 한 줄이 아니다.** 우세손·비우세손·양손 세 층렬로 나뉜다. 선형 글로스
     시퀀스를 만들려면 합쳐서 시간순 정렬해야 한다(`--tiers`로 조절).
  2. **글로스 필드 이름은 `gloss_id`** 다(`gloss`·`name`이 아니다).
  3. **키포인트가 형태소 JSON 안(`landmarks`)에 이미 있다.** 따로 배포되는 키포인트
     XML(수 GB)은 받을 필요가 없다.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import threading
import zipfile
from collections import Counter

try:
    import py7zr.io as py7zr_io
except ImportError:  # 7z 입력을 쓰지 않으면 없어도 된다.
    py7zr_io = None  # type: ignore[assignment]

from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ml.signbridge.openpose import convert_clip, convert_clip_3d  # noqa: E402
from ml.signbridge.pack import SANE_FEATURE_LIMIT, feature_health, save_pack  # noqa: E402

NUM_POSE_OP = 25
NUM_HAND_OP = 21

TIER_KEYS = {
    "both": "sign_gestures_both",
    "strong": "sign_gestures_strong",
    "weak": "sign_gestures_weak",
}

# 3D를 채택하려면 이 비율 이상의 프레임이 위생 검사를 통과해야 한다.
MIN_DEPTH_FRAME_RATIO = 0.7


def stack_keypoints(raw, num_points: int) -> np.ndarray:
    """`landmarks`의 키포인트 배열을 (T, num_points, 3)으로 정규화한다.

    배포본마다 모양이 다를 수 있어 세 가지를 모두 받아들인다.
      · (T, num_points*3) 평탄 배열
      · (T, num_points, 3) 중첩 배열
      · 프레임 하나짜리 1차원 배열
    """
    if raw is None:
        return np.zeros((0, num_points, 3), dtype=np.float32)
    arr = np.asarray(raw, dtype=np.float32)
    if arr.ndim == 1:
        arr = arr[None, :]
    if arr.ndim == 3:
        return arr[:, :num_points, :3]
    expected = num_points * 3
    if arr.shape[1] < expected:
        pad = np.zeros((arr.shape[0], expected - arr.shape[1]), dtype=np.float32)
        arr = np.concatenate([arr, pad], axis=1)
    return arr[:, :expected].reshape(arr.shape[0], num_points, 3)


def read_landmarks(record: dict) -> tuple[dict[str, np.ndarray], bool]:
    """`landmarks`에서 포즈·양손을 뽑는다. 3D 우선, 없으면 2D.

    `landmarks`가 프레임별 딕셔너리의 리스트로 오는 배포본도 있어 두 형태를 모두 처리한다.
    """
    landmarks = record.get("landmarks")
    if not landmarks:
        return {}, False

    if isinstance(landmarks, list):
        # 프레임별 dict 리스트 → 키별로 모아 붙인다.
        merged: dict[str, list] = {}
        for frame in landmarks:
            if not isinstance(frame, dict):
                continue
            for key, value in frame.items():
                if key.endswith(("_2d", "_3d")):
                    merged.setdefault(key, []).append(value)
        landmarks = merged

    for suffix, is_3d in (("_3d", True), ("_2d", False)):
        pose_key = f"pose_keypoints{suffix}"
        if pose_key not in landmarks:
            continue
        pose = stack_keypoints(landmarks.get(pose_key), NUM_POSE_OP)
        if pose.shape[0] == 0:
            continue
        left = stack_keypoints(landmarks.get(f"hand_left_keypoints{suffix}"), NUM_HAND_OP)
        right = stack_keypoints(landmarks.get(f"hand_right_keypoints{suffix}"), NUM_HAND_OP)
        length = min(len(pose), len(left) or len(pose), len(right) or len(pose))
        if len(left) == 0:
            left = np.zeros((length, NUM_HAND_OP, 3), dtype=np.float32)
        if len(right) == 0:
            right = np.zeros((length, NUM_HAND_OP, 3), dtype=np.float32)
        return (
            {
                "pose": pose[:length],
                "hand_left": left[:length],
                "hand_right": right[:length],
            },
            is_3d,
        )
    return {}, False


def read_glosses(record: dict, tiers: list[str]) -> list[dict]:
    """`sign_script`의 층렬들을 하나의 시간순 글로스 시퀀스로 합친다.

    같은 동작이 여러 층렬에 중복 기재되는 경우가 있어 (시작, 끝, 글로스)로 중복을 제거한다.
    """
    script = record.get("sign_script") or {}
    entries: list[dict] = []
    seen: set[tuple] = set()

    for tier in tiers:
        key = TIER_KEYS.get(tier, tier)
        for item in script.get(key) or []:
            if not isinstance(item, dict):
                continue
            gloss = item.get("gloss_id")
            start = item.get("start")
            end = item.get("end")
            if not gloss or start is None or end is None:
                continue
            signature = (round(float(start), 3), round(float(end), 3), gloss)
            if signature in seen:
                continue
            seen.add(signature)
            entries.append(
                {
                    "gloss": str(gloss),
                    "start": float(start),
                    "end": float(end),
                    "tier": tier,
                    "express": item.get("express", ""),
                }
            )

    entries.sort(key=lambda e: (e["start"], e["end"]))
    return entries


METADATA_KEYS = ("metadata", "metaData", "meta")

# 예: NIA_SL_G1_COLDWAVE000021_1_TW07
#     └그룹  └재난 카테고리 └번호 └1:1~1:3 └작업자 코드
DISASTER_NAME_RE = re.compile(
    r"^NIA_SL_(?P<group>G\d+)_(?P<category>[A-Z]+)(?P<number>\d+)"
    r"_(?P<ratio>\d+)_(?P<worker>\w+)$"
)


def meta_get(record: dict, key: str, default=None):
    """최상위와 `metadata` 양쪽에서 값을 찾는다.

    **실제 배포본은 signer·augment·video_fps·filmed_in_studio·hand_default를
    전부 `metadata` 안에 넣어 둔다.** 최상위에서만 찾으면 전부 기본값으로 조용히
    떨어지는데, 특히 signer가 비면 `--split-by signer`가 clip 해시로 대체되어
    **수어자 분리 평가가 무력화되고 정확도가 부풀려진다.** 가장 위험한 실패였다.
    """
    if key in record:
        return record[key]
    for meta_key in METADATA_KEYS:
        container = record.get(meta_key)
        if isinstance(container, dict) and key in container:
            return container[key]
    return default


def parse_disaster_name(stem: str, path: Path | None = None) -> dict:
    """파일명·경로에서 재난 카테고리 등을 뽑는다.

    카테고리(COLDWAVE, TYPHOON …)는 **재난 유형**이라 층화 분할·유형별 성능 분석에
    바로 쓸 수 있다. 경로에도 `.../1.자연재난/COLDWAVE/1_1/...` 형태로 들어 있어
    파일명이 규칙을 벗어나면 경로에서 보완한다.
    """
    info: dict[str, str] = {}
    match = DISASTER_NAME_RE.match(stem)
    if match:
        info["category"] = match.group("category")
        info["number"] = match.group("number")
        info["group"] = match.group("group")
        info["ratio"] = match.group("ratio")
        info["worker"] = match.group("worker")

    if path is not None and "category" not in info:
        for part in path.parts:
            if part.isupper() and part.isalpha() and len(part) >= 4:
                info["category"] = part
                break
    return info


def extract_signer(record: dict) -> str:
    """수어자 식별자. 수어자 분리 분할에 쓰이므로 **안정적인 값**이어야 한다."""
    signer = meta_get(record, "signer")
    if isinstance(signer, dict):
        for key in ("id", "signer_id", "name", "code", "no"):
            value = signer.get(key)
            if value not in (None, ""):
                return str(value)
        return json.dumps(signer, ensure_ascii=False, sort_keys=True)[:64]
    if signer not in (None, ""):
        return str(signer)
    return ""


# zip 안의 JSON을 압축을 풀지 않고 그대로 읽기 위한 캐시.
#
# 형태소 JSON은 텍스트라 압축률이 높다(재난안전 학습셋은 zip 90GB인데 풀면 수백 GB).
# 전부 풀어 두면 디스크가 감당이 안 되고, 하나씩 풀었다 지우면 느리다. 그래서 zip을
# 열어 둔 채로 멤버만 꺼내 쓴다. ZipFile 핸들은 프로세스마다 따로 잡아야 하므로
# (fork된 자식이 부모의 파일 오프셋을 공유하면 깨진다) 워커 안에서 지연 생성한다.
_ZIP_CACHE: dict[str, zipfile.ZipFile] = {}


def _zip_handle(zip_path: Path) -> zipfile.ZipFile:
    key = str(zip_path)
    handle = _ZIP_CACHE.get(key)
    if handle is None:
        handle = zipfile.ZipFile(zip_path)
        _ZIP_CACHE[key] = handle
    return handle


def convert_file(
    json_path: Path,
    out_dir: Path,
    tiers: list[str],
    depth: str,
    zip_path: Path | None = None,
    raw: bytes | None = None,
) -> dict | None:
    if raw is not None:
        # 이미 메모리에 있는 JSON 바이트(7z 스트리밍 경로). json_path는 이름표일 뿐이다.
        record = json.loads(raw.decode("utf-8-sig"))
    elif zip_path is not None:
        # json_path는 zip 내부 멤버 이름이다(파일시스템에 없다).
        record = json.loads(_zip_handle(zip_path).read(json_path.as_posix()).decode("utf-8-sig"))
    else:
        with open(json_path, encoding="utf-8") as handle:
            record = json.load(handle)

    # 일부 배포본은 {"0": {...}} 처럼 한 겹 감싸서 준다.
    if "sign_script" not in record and "landmarks" not in record:
        for value in record.values():
            if isinstance(value, dict) and ("sign_script" in value or "landmarks" in value):
                record = value
                break

    keypoints, is_3d = read_landmarks(record)
    if not keypoints:
        return {"__no_landmarks__": json_path.name}

    depth_ratio = 0.0
    has_depth = False
    if is_3d and depth == "auto":
        arrays, frame_ok = convert_clip_3d(
            {
                "pose": keypoints["pose"].reshape(len(keypoints["pose"]), -1),
                "hand_left": keypoints["hand_left"].reshape(len(keypoints["hand_left"]), -1),
                "hand_right": keypoints["hand_right"].reshape(len(keypoints["hand_right"]), -1),
            }
        )
        depth_ratio = float(np.mean(frame_ok)) if len(frame_ok) else 0.0
        has_depth = depth_ratio >= MIN_DEPTH_FRAME_RATIO
    if not has_depth:
        arrays = convert_clip(
            {
                "pose": keypoints["pose"].reshape(len(keypoints["pose"]), -1),
                "hand_left": keypoints["hand_left"].reshape(len(keypoints["hand_left"]), -1),
                "hand_right": keypoints["hand_right"].reshape(len(keypoints["hand_right"]), -1),
            }
        )

    clip_id = str(meta_get(record, "id") or json_path.stem)
    fps = float(meta_get(record, "video_fps") or 30.0)
    name_info = parse_disaster_name(clip_id, json_path)
    glosses = read_glosses(record, tiers)
    source = "aihub-disaster-3d" if has_depth else "aihub-disaster-2d"

    meta = {
        "id": clip_id,
        "fps": fps,
        "korean_text": record.get("korean_text", ""),
        "glosses": glosses,
        "source": source,
        "has_depth": has_depth,
    }
    rel = f"packs/{clip_id}.npz"
    save_pack(out_dir / rel, arrays, meta)
    health = feature_health(arrays)

    return {
        "id": clip_id,
        "feature_max_abs": round(health, 2),
        "npz": rel,
        "fps": fps,
        "num_frames": int(arrays["pose"].shape[0]),
        "korean_text": meta["korean_text"],
        "glosses": glosses,
        "signer": extract_signer(record),
        "source": source,
        "has_depth": has_depth,
        "depth_frame_ratio": round(depth_ratio, 4),
        # 아래 두 필드는 분할·필터링에 쓰인다(prepare.py 참고).
        "augment": bool(meta_get(record, "augment", False)),
        "filmed_in_studio": bool(meta_get(record, "filmed_in_studio", True)),
        "hand_default": meta_get(record, "hand_default", ""),
        # 재난 유형(COLDWAVE, TYPHOON …). 층화 분할·유형별 성능 분석에 쓴다.
        "category": name_info.get("category", ""),
        "content_id": f"{name_info.get('category', '')}{name_info.get('number', '')}" or clip_id,
    }


def _worker(payload: tuple) -> dict | None:
    json_path, out_dir, tiers, depth, zip_path, raw = payload
    try:
        return convert_file(json_path, out_dir, tiers, depth, zip_path, raw)
    except Exception as error:
        print(f"  [warn] {json_path.name}: {type(error).__name__}: {error}", flush=True)
        return None


# ── 아카이브 종류 판별 ────────────────────────────────────────────────────────
# **AI Hub의 `*.zip`은 실제로는 7z다.** 확장자만 zip이고 내용은 7-Zip(LZMA2) 아카이브라
# 파이썬 `zipfile`도 `unzip`도 열지 못한다("End-of-central-directory signature not found").
# 확장자를 믿지 말고 매직 바이트로 판별한다.
ZIP_MAGIC = b"PK\x03\x04"
SEVENZ_MAGIC = b"7z\xbc\xaf\x27\x1c"


def archive_kind(path: Path) -> str:
    """'zip' | '7z' | '' (아카이브 아님)"""
    try:
        with open(path, "rb") as handle:
            head = handle.read(6)
    except OSError:
        return ""
    if head.startswith(SEVENZ_MAGIC):
        return "7z"
    if head.startswith(ZIP_MAGIC):
        return "zip"
    return ""


def find_archives(root: Path) -> list[Path]:
    if root.is_file():
        return [root] if archive_kind(root) else []
    found = [p for p in sorted(root.rglob("*")) if p.is_file() and archive_kind(p)]
    return found


def collect_inputs(root: Path) -> list[tuple[Path, Path | None]]:
    """진짜 zip과 낱개 JSON을 (경로, 소속 zip) 쌍으로 모은다. 7z는 여기서 다루지 않는다."""
    items: list[tuple[Path, Path | None]] = []
    for archive in find_archives(root):
        if archive_kind(archive) != "zip":
            continue
        with zipfile.ZipFile(archive) as handle:
            items.extend(
                (Path(name), archive)
                for name in handle.namelist()
                if name.lower().endswith(".json") and not name.endswith("/")
            )

    if root.is_dir():
        items.extend((path, None) for path in sorted(root.rglob("*.json")))
    return items


# ── 7z 스트리밍 ──────────────────────────────────────────────────────────────
# 재난안전 아카이브는 `Solid = +`, `Blocks = 1`, 즉 **통짜로 압축**돼 있다. 멤버 하나를
# 꺼내려 해도 앞에서부터 다 풀어야 하므로, 파일마다 따로 열면 O(n²)가 되어 끝나지 않는다.
# 유일하게 실용적인 방법은 **처음부터 끝까지 한 번만 훑으면서** 멤버가 풀릴 때마다 곧바로
# 처리하는 것이다. py7zr의 WriterFactory가 그 자리를 준다 — 멤버 하나가 다 풀리면
# `Py7zIO.close()`가 불린다. 그때 JSON을 넘기고 버퍼를 비운다(메모리 일정하게 유지).
#
# 압축 해제 자체는 순차라 한 스레드지만, 무거운 쪽은 좌표 변환(numpy)이므로 그건 프로세스
# 풀로 넘긴다. 다만 무한정 넘기면 안 넘어간 JSON이 메모리에 쌓이므로 in-flight를 제한한다.


def _json_only_factory(on_done):
    """JSON만 메모리로 받고 나머지(xlsx·mp4 등)는 /dev/null로 버리는 WriterFactory.

    py7zr가 없는 환경에서도 모듈을 import할 수 있어야 하므로 클래스를 함수 안에 둔다.
    """
    if py7zr_io is None:
        raise SystemExit("7z 아카이브를 읽으려면 py7zr가 필요합니다:  pip install py7zr")

    class _JsonSink(py7zr_io.Py7zIO):
        """멤버 하나를 메모리에 받아 두었다가, 다 풀리는 순간 콜백으로 넘긴다."""

        def __init__(self, name: str) -> None:
            self.name = name
            self._buf = bytearray()

        def write(self, s: bytes | bytearray) -> int:
            self._buf += s
            return len(s)

        def read(self, size: int | None = None) -> bytes:
            return bytes(self._buf)

        def seek(self, offset: int, whence: int = 0) -> int:
            return offset

        def flush(self) -> None:
            return None

        def size(self) -> int:
            return len(self._buf)

        def close(self) -> None:
            if self._buf:
                on_done(self.name, bytes(self._buf))
            self._buf = bytearray()

    class _JsonOnlyFactory(py7zr_io.WriterFactory):
        def create(self, filename: str):
            if filename.lower().endswith(".json"):
                return _JsonSink(filename)
            return py7zr_io.NullIO()

    return _JsonOnlyFactory()


def stream_7z(
    archive: Path,
    out_dir: Path,
    tiers: list[str],
    depth: str,
    workers: int,
    limit: int,
    on_result,
) -> int:
    """7z를 한 번만 훑으면서 JSON을 변환한다. 처리한 개수를 돌려준다.

    **콜백은 여러 스레드에서 동시에 불린다.** 재난안전 검증셋은 `Blocks = 26`이라
    py7zr가 블록별로 병렬 해제하기 때문이다(`Blocks = 1`이면 단일 스레드). 카운터와
    대기열을 락 없이 만지면 진행 표시가 어긋나고 백프레셔가 무너지므로 락을 건다.
    풀린 순서는 보장되지 않지만, 결과는 마지막에 id로 정렬하므로 상관없다.
    """
    import py7zr

    max_inflight = max(2, workers * 2)
    seen = 0
    guard = threading.Lock()

    with ProcessPoolExecutor(max_workers=max(1, workers)) as pool:
        pending: list = []

        def drain(keep: int) -> None:
            while True:
                with guard:
                    if len(pending) <= keep:
                        return
                    future = pending.pop(0)
                # 결과 대기는 락 밖에서 — 안에서 기다리면 해제 스레드가 전부 막힌다.
                on_result(future.result())

        def handle(name: str, raw: bytes) -> None:
            nonlocal seen
            with guard:
                if limit and seen >= limit:
                    return
                seen += 1
                count = seen
                pending.append(
                    pool.submit(_worker, (Path(name), out_dir, tiers, depth, None, raw))
                )
            # 먼저 넣은 것부터 걷어내 메모리를 일정하게 유지한다.
            drain(max_inflight)
            if count % 500 == 0:
                print(f"  [etl] {count}개 처리", flush=True)

        with py7zr.SevenZipFile(archive, "r") as handle_7z:
            handle_7z.extractall(factory=_json_only_factory(handle))

        drain(0)
    return seen


def main() -> None:
    parser = argparse.ArgumentParser(description="재난안전 수어영상 형태소 JSON → 랜드마크 팩")
    parser.add_argument(
        "--input",
        type=Path,
        required=True,
        help="형태소/비수지 JSON — 디렉터리·zip·7z 모두 가능(압축을 풀지 않고 읽는다)",
    )
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument(
        "--tiers",
        default="both,strong,weak",
        help="합칠 글로스 층렬(쉼표 구분). 기본은 셋 모두 합쳐 시간순 정렬",
    )
    parser.add_argument("--depth", choices=["auto", "off"], default="auto")
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    tiers = [t.strip() for t in args.tiers.split(",") if t.strip()]
    args.out.mkdir(parents=True, exist_ok=True)

    results: list = []
    sevenz = [p for p in find_archives(args.input) if archive_kind(p) == "7z"]
    files = collect_inputs(args.input)
    if args.limit:
        files = files[: args.limit]
    if not files and not sevenz:
        raise SystemExit(f"JSON이 없습니다: {args.input}")

    # 7z는 통짜 압축이라 한 번만 훑는다(무작위 접근 불가). 아카이브별로 순서대로.
    for archive in sevenz:
        print(f"[etl] 7z 스트리밍: {archive.name} (층렬={tiers}, workers={args.workers})")
        done = stream_7z(
            archive, args.out, tiers, args.depth, args.workers, args.limit, results.append
        )
        print(f"[etl] {archive.name}에서 JSON {done}개 처리")

    if files:
        from_zip = sum(1 for _, archive in files if archive is not None)
        print(
            f"[etl] 형태소 JSON {len(files)}개 변환 "
            f"(zip 안 {from_zip}개, 층렬={tiers}, workers={args.workers})"
        )
        payloads = [
            (path, args.out, tiers, args.depth, archive, None) for path, archive in files
        ]
        if args.workers <= 1:
            results.extend(_worker(p) for p in payloads)
        else:
            with ProcessPoolExecutor(max_workers=args.workers) as pool:
                futures = [pool.submit(_worker, p) for p in payloads]
                for index, future in enumerate(as_completed(futures), start=1):
                    results.append(future.result())
                    if index % 500 == 0:
                        print(f"  {index}/{len(payloads)}", flush=True)

    records: list[dict] = []
    no_landmarks: list[str] = []

    for result in results:
        if not result:
            continue
        if "__no_landmarks__" in result:
            no_landmarks.append(result["__no_landmarks__"])
        else:
            records.append(result)

    records.sort(key=lambda r: r["id"])
    index_path = args.out / "index.jsonl"
    with open(index_path, "w", encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")

    total_glosses = sum(len(r["glosses"]) for r in records)
    with_depth = sum(1 for r in records if r["has_depth"])
    signers = {r["signer"] for r in records if r["signer"]}
    augmented = sum(1 for r in records if r["augment"])
    remote = sum(1 for r in records if not r["filmed_in_studio"])

    print(f"\n[etl] 클립 {len(records)}개, 글로스 구간 {total_glosses}개 → {index_path}")
    print(f"[etl] 깊이(z) 포함 {with_depth}개 · 수어자 {len(signers)}명")
    print(f"[etl] 증강 문장 {augmented}개 · 비대면 촬영 {remote}개")
    unhealthy = [r for r in records if r.get("feature_max_abs", 0) > SANE_FEATURE_LIMIT]
    if unhealthy:
        print(
            f"[etl] ⚠️ 어깨 검출이 무너진 것으로 보이는 클립 {len(unhealthy)}개"
            f" (정규화 좌표가 {SANE_FEATURE_LIMIT:.0f}배 초과). 예: "
            + ", ".join(f"{r['id']}({r['feature_max_abs']:.0f})" for r in unhealthy[:3])
        )
        print("[etl]    이런 클립은 학습에 넣으면 해가 됩니다 — 원본 키포인트를 확인하세요.")
    categories = Counter(r["category"] for r in records if r["category"])
    if categories:
        top = ", ".join(f"{k} {v}" for k, v in categories.most_common(8))
        print(f"[etl] 재난 유형 {len(categories)}종: {top}")
    if no_landmarks:
        print(
            f"[etl] ⚠️ landmarks가 없는 파일 {len(no_landmarks)}개 (예: {no_landmarks[:3]}). "
            "키포인트가 별도 XML로만 제공되는 배포본일 수 있습니다."
        )
    if not signers:
        print("[etl] ⚠️ signer 정보를 못 찾았습니다 → prepare.py가 clip 해시 분할로 대체합니다.")


if __name__ == "__main__":
    main()

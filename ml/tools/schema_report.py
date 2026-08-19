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

# **AI Hub의 `*.zip`은 실제로는 7z다.** 확장자만 zip이고 내용은 7-Zip(LZMA2)이라
# zipfile도 unzip도 열지 못한다. 확장자를 믿지 말고 매직 바이트로 판별한다.
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


def classify(name: str) -> str:
    lowered = name.lower()
    if lowered.endswith("_keypoints.json"):
        return "키포인트"
    if "morpheme" in lowered:
        return "형태소(글로스)"
    if lowered.endswith(".json"):
        return "기타 JSON"
    if lowered.endswith((".mp4", ".avi")):
        return "영상"
    if lowered.endswith((".xml",)):
        return "XML"
    return "기타"


def inventory(names: list[str]) -> None:
    """파일 종류와 폴더 구조를 요약한다.

    **형태소 파일이 들어 있는지**가 특히 중요하다. 키포인트만 있으면 글로스 라벨이 없어
    학습을 시작할 수 없다(형태소는 전부 합쳐도 0.2GB 남짓이라 따로 받으면 된다).
    """
    kinds: dict[str, int] = {}
    tops: dict[str, int] = {}
    clips: set[str] = set()

    for name in names:
        kinds[classify(name)] = kinds.get(classify(name), 0) + 1
        parts = name.replace("\\", "/").split("/")
        # 파일명은 빼고 상위 3단계 폴더만 센다(클립마다 폴더가 하나씩이라 그대로 두면
        # 폴더 목록이 곧 파일 목록이 되어 버린다).
        folder = "/".join(parts[:-1][:3]) or "(최상위)"
        tops[folder] = tops.get(folder, 0) + 1
        base = parts[-1]
        if base.endswith("_keypoints.json"):
            head = base[: -len("_keypoints.json")]
            clips.add(head.rsplit("_", 1)[0] if "_" in head else head)

    print("파일 종류")
    for kind, count in sorted(kinds.items(), key=lambda kv: -kv[1]):
        print(f"  {kind:16s} {count:,}개")
    if clips:
        print(f"\n키포인트 클립 수: {len(clips):,}개 (예: {sorted(clips)[:3]})")
    if "형태소(글로스)" not in kinds:
        print("\n⚠️ 형태소(글로스) 파일이 없습니다 — 라벨이 없으면 학습을 시작할 수 없습니다.")
        print("   AI Hub에서 `*_morpheme.zip`을 따로 받으세요(전부 합쳐도 0.2GB 남짓).")

    print("\n폴더 구조 (상위 12개)")
    for folder, count in sorted(tops.items(), key=lambda kv: -kv[1])[:12]:
        print(f"  {folder}  … {count:,}개")
    print()


class _StopEarly(Exception):
    """필요한 만큼 봤으니 그만 풀라는 신호."""


def iter_7z(path: Path, limit: int) -> Iterator[tuple[str, Any]]:
    """7z에서 JSON 몇 개만 꺼낸다.

    AI Hub 아카이브는 `Solid = +`, 즉 통짜로 압축돼 있어 특정 파일만 골라 뽑을 수 없다.
    앞에서부터 풀되 필요한 개수를 채우면 예외로 중단시킨다 — 90GB짜리를 끝까지 푸는
    사고를 막기 위해서다.
    """
    try:
        import py7zr
        import py7zr.io as pio
    except ImportError:
        raise SystemExit("7z 아카이브입니다. 읽으려면:  pip install py7zr")

    with py7zr.SevenZipFile(path, "r") as handle:
        inventory(handle.getnames())

    collected: list[tuple[str, bytes]] = []

    class _Sink(pio.Py7zIO):
        def __init__(self, name: str) -> None:
            self.name = name
            self._buf = bytearray()

        def write(self, s):
            self._buf += s
            return len(s)

        def read(self, size=None):
            return bytes(self._buf)

        def seek(self, offset, whence=0):
            return offset

        def flush(self):
            return None

        def size(self):
            return len(self._buf)

        def close(self):
            if self._buf:
                collected.append((self.name, bytes(self._buf)))
            self._buf = bytearray()
            if len(collected) >= limit:
                raise _StopEarly

    class _Factory(pio.WriterFactory):
        def create(self, filename: str):
            if filename.lower().endswith(".json"):
                return _Sink(filename)
            return pio.NullIO()

    try:
        with py7zr.SevenZipFile(path, "r") as handle:
            handle.extractall(factory=_Factory())
    except _StopEarly:
        pass

    print(f"  (앞에서부터 JSON {len(collected)}개 확인)\n")
    for name, raw in collected[:limit]:
        try:
            yield name, json.loads(raw.decode("utf-8-sig"))
        except Exception as error:
            yield name, {"__파싱실패__": f"{type(error).__name__}: {error}"}


def iter_json(path: Path, limit: int) -> Iterator[tuple[str, Any]]:
    """파일·디렉터리·zip·7z 어디서든 JSON을 꺼내 준다."""
    if path.is_dir():
        every = [str(p.relative_to(path)) for p in path.rglob("*") if p.is_file()]
        inventory(every)
        candidates = sorted(path.rglob("*.json"))
        candidates.sort(key=lambda p: (0 if "morpheme" in p.name.lower() else 1, str(p)))
        files = candidates[:limit]
        for file in files:
            try:
                yield str(file.relative_to(path)), json.loads(file.read_text(encoding="utf-8"))
            except Exception as error:
                yield str(file), {"__파싱실패__": f"{type(error).__name__}: {error}"}
        if files:
            return
        # 낱개 JSON이 없으면 디렉터리 안의 아카이브를 들여다본다. AI Hub에서 막 받은
        # 상태가 정확히 이 모양이다(폴더 안에 `*.zip`, 실제로는 7z).
        for archive in sorted(path.rglob("*")):
            if archive.is_file() and archive_kind(archive):
                print(f"── 아카이브 안을 봅니다: {archive.name}\n")
                yield from iter_json(archive, limit)
                return
        return

    kind = archive_kind(path)
    if kind == "7z":
        yield from iter_7z(path, limit)
        return

    if kind == "zip":
        with zipfile.ZipFile(path) as archive:
            all_names = archive.namelist()
            inventory(all_names)
            json_names = [n for n in all_names if n.lower().endswith(".json")]
            # 형태소 파일이 있으면 그것부터 보여 준다(글로스 구조가 가장 중요하다).
            json_names.sort(key=lambda n: (0 if "morpheme" in n.lower() else 1, n))
            names = json_names[:limit]
            print(f"  (JSON {len(json_names):,}개 중 {len(names)}개 확인)\n")
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

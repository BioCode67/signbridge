"""AI Hub 배포 아카이브를 압축을 풀지 않고 읽는다.

**AI Hub의 `*.zip`은 실제로는 7z다.** 확장자만 zip이고 내용은 7-Zip(LZMA2)이라
`unzip`도 파이썬 `zipfile`도 열지 못한다("End-of-central-directory signature not found").
게다가 `Solid = +`, `Blocks = 1`, 즉 **통짜로 압축**돼 있어 멤버 하나를 꺼내려 해도
앞에서부터 전부 풀어야 한다. 파일마다 따로 열면 O(n²)가 되어 90GB에서는 끝나지 않는다.

그래서 7z는 **처음부터 끝까지 한 번만 훑으면서** 멤버가 풀릴 때마다 곧바로 넘긴다.
py7zr의 `WriterFactory`가 그 자리를 준다 — 멤버 하나가 다 풀리면 `Py7zIO.close()`가
불린다. 그때 바이트를 콜백으로 넘기고 버퍼를 비우므로 메모리가 일정하게 유지된다.
"""

from __future__ import annotations

import zipfile
from pathlib import Path
from typing import Callable, Iterable

ZIP_MAGIC = b"PK\x03\x04"
SEVENZ_MAGIC = b"7z\xbc\xaf\x27\x1c"


def archive_kind(path: Path) -> str:
    """'zip' | '7z' | '' (아카이브 아님). **확장자를 믿지 말 것.**"""
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
    """디렉터리(또는 파일 하나) 아래의 아카이브를 매직 바이트로 찾아 정렬해 돌려준다."""
    if root.is_file():
        return [root] if archive_kind(root) else []
    return [p for p in sorted(root.rglob("*")) if p.is_file() and archive_kind(p)]


class StopStreaming(Exception):
    """필요한 만큼 읽었으니 그만 풀라는 신호. `stream_archive`가 삼킨다."""


def _writer_factory(suffixes: tuple[str, ...], on_member: Callable[[str, bytes], None]):
    """관심 있는 확장자만 메모리로 받고 나머지는 /dev/null로 흘리는 WriterFactory.

    py7zr가 없는 환경에서도 이 모듈을 import할 수 있어야 하므로 클래스를 함수 안에 둔다.
    """
    try:
        import py7zr.io as pio
    except ImportError:
        raise SystemExit("7z 아카이브를 읽으려면 py7zr가 필요합니다:  pip install py7zr")

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
                on_member(self.name, bytes(self._buf))
            self._buf = bytearray()

    class _Factory(pio.WriterFactory):
        def create(self, filename: str):
            if filename.lower().endswith(suffixes):
                return _Sink(filename)
            return pio.NullIO()

    return _Factory()


def stream_archive(
    archive: Path,
    suffixes: Iterable[str],
    on_member: Callable[[str, bytes], None],
) -> None:
    """아카이브를 한 번만 훑으며 해당 확장자 멤버를 (이름, 바이트)로 넘긴다.

    `on_member`가 `StopStreaming`을 던지면 거기서 멈춘다 — 구조만 보려다 90GB를
    끝까지 푸는 사고를 막는 탈출구다.
    """
    suffix_tuple = tuple(s.lower() for s in suffixes)
    kind = archive_kind(archive)

    if kind == "7z":
        import py7zr

        try:
            with py7zr.SevenZipFile(archive, "r") as handle:
                handle.extractall(factory=_writer_factory(suffix_tuple, on_member))
        except StopStreaming:
            pass
        return

    if kind == "zip":
        # 진짜 zip은 무작위 접근이 되지만, 호출부가 한 가지 방식만 다루면 되도록
        # 여기서도 같은 콜백 모양으로 맞춰 준다.
        try:
            with zipfile.ZipFile(archive) as handle:
                for name in handle.namelist():
                    if name.endswith("/") or not name.lower().endswith(suffix_tuple):
                        continue
                    on_member(name, handle.read(name))
        except StopStreaming:
            pass
        return

    raise SystemExit(f"아카이브가 아닙니다: {archive}")


def member_names(archive: Path) -> list[str]:
    """헤더만 읽어 멤버 이름을 나열한다(압축 해제 없음)."""
    kind = archive_kind(archive)
    if kind == "7z":
        import py7zr

        with py7zr.SevenZipFile(archive, "r") as handle:
            return list(handle.getnames())
    if kind == "zip":
        with zipfile.ZipFile(archive) as handle:
            return handle.namelist()
    return []

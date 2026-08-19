"""배포 환경에서 모델·동작사전을 내려받아 푼다.

모델(KoBART best 475MB)과 글로스 동작사전은 저장소에 넣을 수 없어서, 배포 시작 시
URL에서 받아 `/tmp/assets/` 아래에 푼다. 이미 있으면 건너뛴다(재시작 시 빠르게 뜨도록).

    T2G_MODEL_URL   → $T2G_MODEL  (기본 /tmp/assets/t2g-best)
    GLOSS_BANK_URL  → $GLOSS_BANK (기본 /tmp/assets/glossbank)

둘 다 tar.gz이고, 아카이브 최상위가 곧 대상 디렉터리 내용이어야 한다:
    tar czf t2g-best.tar.gz -C <runs>/t2g-v3/best .
    tar czf glossbank.tar.gz -C <데이터>/glossbank .

URL이 없으면 조용히 넘어간다 — 서버는 뜨고, 해당 기능만 비활성으로 응답한다.
"""

from __future__ import annotations

import os
import sys
import tarfile
import tempfile
import urllib.request
from pathlib import Path

PAIRS = [
    ("T2G_MODEL_URL", "T2G_MODEL", "/tmp/assets/t2g-best"),
    ("GLOSS_BANK_URL", "GLOSS_BANK", "/tmp/assets/glossbank"),
]


def fetch(url: str, dest: Path) -> None:
    if dest.exists() and any(dest.iterdir()):
        print(f"[assets] 이미 있음, 건너뜀: {dest}")
        return
    dest.mkdir(parents=True, exist_ok=True)
    print(f"[assets] 받는 중: {url}")
    with tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False) as tmp:
        with urllib.request.urlopen(url) as src:  # noqa: S310 — 운영자가 넣은 URL
            while chunk := src.read(1 << 20):
                tmp.write(chunk)
        tmp_path = tmp.name
    try:
        with tarfile.open(tmp_path) as archive:
            # 경로 탈출 방지 — 아카이브가 ../ 로 밖을 건드리지 못하게 한다.
            root = dest.resolve()
            for member in archive.getmembers():
                target = (root / member.name).resolve()
                if not str(target).startswith(str(root)):
                    raise SystemExit(f"아카이브에 비정상 경로: {member.name}")
            archive.extractall(dest)
        print(f"[assets] 풀었음 → {dest}")
    finally:
        os.unlink(tmp_path)


def main() -> None:
    for url_key, path_key, default in PAIRS:
        url = os.environ.get(url_key)
        if not url:
            print(f"[assets] {url_key} 없음 — 건너뜀")
            continue
        try:
            fetch(url, Path(os.environ.get(path_key, default)))
        except Exception as error:  # 자산 하나가 실패해도 서버는 떠야 한다
            print(f"[assets] {url_key} 실패: {type(error).__name__}: {error}", file=sys.stderr)


if __name__ == "__main__":
    main()

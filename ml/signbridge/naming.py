"""AI Hub「수어 영상」파일명 파서.

공식 구축활용가이드(표2·표3)의 명명 규칙:

    영상    NIA_SL_[SEN|WRD|FINSP]XXXX_[REAL|SYN|CROWD]XX_[F|U|D|R|L].mp4
    형태소  NIA_SL_[SEN|WRD]XXXX_[REAL|SYN|CROWD]XX_[F|U|D|R|L]_morpheme.json
    키포인트 NIA_SL_[SEN|WRD]XXXX_[REAL|SYN|CROWD]XX_[F|U|D|R|L]_FFFF_keypoints.json
                                                              └ 프레임 번호

파일명만으로 세 가지를 알 수 있다는 점이 중요하다.

  · **수어자**(REAL01~20, CROWD01~21) → 별도 메타데이터 없이 **수어자 분리 평가**가 가능하다.
  · **촬영각도**(F/U/D/R/L) → 같은 동작을 5각도로 찍은 것이므로, 각도를 섞어 학습하면
    카메라 각도에 강해지고, 각도를 나눠 평가하면 일반화를 측정할 수 있다.
  · **콘텐츠 번호**(SEN0001 등) → 같은 문장이 학습·평가에 걸치지 않게 막을 수 있다.

주의: 크라우드소싱(CROWD)은 단방향 촬영이라 각도가 **F만 존재**한다.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# 예: NIA_SL_SEN0001_REAL01_F  /  NIA_SL_WRD1234_CROWD07_F
CLIP_RE = re.compile(
    r"^NIA_SL_(?P<kind>SEN|WRD|FINSP)(?P<content>\d+)"
    r"_(?P<method>REAL|SYN|CROWD)(?P<signer>\d*)"
    r"_(?P<angle>[FUDRL])$"
)

ANGLES = ("F", "U", "D", "R", "L")


@dataclass(frozen=True)
class ClipName:
    stem: str  # 각도까지 포함한 클립 식별자
    kind: str  # SEN(문장) / WRD(단어) / FINSP(지문자·지숫자)
    content_id: str  # SEN0001 — 각도·수어자가 달라도 같은 내용
    method: str  # REAL(실촬영) / SYN(가상) / CROWD(크라우드소싱)
    signer: str  # REAL01 — 수어자 분리 분할의 키
    angle: str  # F/U/D/R/L

    @property
    def is_frontal(self) -> bool:
        return self.angle == "F"


def parse_clip_name(stem: str) -> ClipName | None:
    """`NIA_SL_...` 형태의 스템을 파싱한다. 규칙에 안 맞으면 None."""
    match = CLIP_RE.match(stem)
    if not match:
        return None
    parts = match.groupdict()
    method = parts["method"]
    signer_no = parts["signer"] or "00"
    return ClipName(
        stem=stem,
        kind=parts["kind"],
        content_id=f"{parts['kind']}{parts['content']}",
        method=method,
        signer=f"{method}{signer_no}",
        angle=parts["angle"],
    )


def strip_suffix(filename: str) -> str | None:
    """라벨 파일명에서 클립 스템만 떼어낸다.

    `..._F_morpheme.json` → `..._F`
    `..._F_0007_keypoints.json` → `..._F`
    """
    name = filename
    for extension in (".json", ".mp4", ".avi"):
        if name.endswith(extension):
            name = name[: -len(extension)]
            break

    if name.endswith("_morpheme"):
        return name[: -len("_morpheme")]
    if name.endswith("_keypoints"):
        # 프레임 번호가 한 토막 더 붙어 있다.
        head = name[: -len("_keypoints")]
        return head.rsplit("_", 1)[0] if "_" in head else head
    return name


def frame_index(filename: str) -> int:
    """키포인트 파일명에서 프레임 번호를 뽑는다. 없으면 0."""
    name = filename[:-5] if filename.endswith(".json") else filename
    if not name.endswith("_keypoints"):
        return 0
    head = name[: -len("_keypoints")]
    tail = head.rsplit("_", 1)[-1] if "_" in head else ""
    return int(tail) if tail.isdigit() else 0

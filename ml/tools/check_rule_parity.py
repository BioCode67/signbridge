#!/usr/bin/env python3
"""파이썬(학습·사전 생성)과 TS(브라우저 번역)의 **규칙이 같은지** 검사한다.

    python3 ml/tools/check_rule_parity.py

`ml/etl/build_align_dict.py`가 사전 키를 만들 때 떼는 조사·어미와,
`src/agents/dictSignAgent.ts`가 런타임에 떼는 조사·어미는 **같아야 한다.**
한쪽만 고치면 사전 키와 조회 키가 어긋나 조용히 못 찾는다 — 화면에는
아무 오류도 안 나고 그냥 낱말이 빠진다. 이 프로젝트에서 가장 찾기 어려운 실패다.

`ml/tools/feature_parity`가 학습 특징과 추론 특징을 맞추는 것과 같은 이유의 검사다.
그쪽은 숫자를 대조하고, 이쪽은 규칙 집합을 대조한다.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PY_SRC = ROOT / "ml/etl/build_align_dict.py"
TS_SRC = ROOT / "src/agents/dictSignAgent.ts"


def py_particles(text: str) -> set[str]:
    m = re.search(r"PARTICLE_RE = re\.compile\((.*?)\n\)", text, re.S)
    if not m:
        return set()
    # 주석 줄(#)은 빼고 문자열만 이어 붙인다 — 주석 안의 한글이 토큰으로 섞였다
    lines = [ln for ln in m.group(1).splitlines() if not ln.strip().startswith("#")]
    body = "".join(re.findall(r'r?"([^"]*)"', "\n".join(lines)))
    return {t for t in body.replace("(", "").replace(")$", "").split("|") if t}


def ts_particles(text: str) -> set[str]:
    m = re.search(r"const PARTICLE_RE =\s*\n?\s*/\((.*?)\)\$/", text, re.S)
    if not m:
        return set()
    lines = [ln for ln in m.group(1).splitlines() if not ln.strip().startswith("//")]
    body = re.sub(r"\s+", "", "".join(lines))
    return {t for t in body.split("|") if t}


def py_stop(text: str) -> set[str]:
    m = re.search(r"STOP_WORDS = \{(.*?)\n\}", text, re.S)
    return set(re.findall(r'"([^"]+)"', m.group(1))) if m else set()


def ts_stop(text: str) -> set[str]:
    m = re.search(r"const STOP_WORDS = new Set\(\[(.*?)\n\]\)", text, re.S)
    return set(re.findall(r"'([^']+)'", m.group(1))) if m else set()


def compare(name: str, a: set[str], b: set[str]) -> bool:
    if not a or not b:
        print(f"  ✗ {name}: 한쪽을 읽지 못했습니다 (파이썬 {len(a)} · TS {len(b)}) — "
              f"정규식 형태가 바뀌었는지 확인하세요")
        return False
    only_py, only_ts = sorted(a - b), sorted(b - a)
    if not only_py and not only_ts:
        print(f"  ✓ {name} 일치 ({len(a)}개)")
        return True
    print(f"  ✗ {name} 어긋남")
    if only_py:
        print(f"      파이썬에만: {only_py}")
    if only_ts:
        print(f"      TS에만:     {only_ts}")
    return False


def main() -> int:
    py = PY_SRC.read_text(encoding="utf-8")
    ts = TS_SRC.read_text(encoding="utf-8")
    print("[parity] 사전 생성(파이썬) ↔ 브라우저 번역(TS) 규칙 대조")
    ok = compare("조사·어미 패턴", py_particles(py), ts_particles(ts))
    ok &= compare("번역 제외어", py_stop(py), ts_stop(ts))
    if not ok:
        print("\n  한쪽만 고치면 사전 키와 조회 키가 어긋나 낱말이 조용히 빠집니다.")
        print(f"  {PY_SRC.relative_to(ROOT)} 와 {TS_SRC.relative_to(ROOT)} 를 맞추세요.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

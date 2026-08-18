"""CTC 디코딩이 **파이썬과 브라우저에서 같은 답을 내는지** 실행해서 확인한다.

    python -m ml.tools.ctc_parity                 # 기본 200판
    python -m ml.tools.ctc_parity --cases 2000 --seed 7

**왜 필요한가.** 학습·평가는 파이썬 디코더(`ml/signbridge/metrics.py`)로 WER를 재고,
사용자가 보는 자막은 브라우저 디코더(`src/recognition/ctcRecognizer.ts`)가 만든다.
둘이 어긋나면 **"WER 0.30인데 화면에서는 말이 안 되는 문장"** 이 나온다.
특징 규격 불일치(`feature_parity`)와 똑같은 종류의 실패이고, 똑같이 눈으로는 못 잡는다.

CTC 축약 규칙은 두 줄뿐이라 쉬워 보이지만 틀리기 쉬운 자리가 있다.

  · 중복 제거는 **직전 프레임과** 비교해야 한다. 결과의 마지막과 비교하면
    "학교 ... 학교"처럼 같은 낱말이 두 번 나오는 문장이 하나로 뭉개진다.
  · blank는 버리되 **previous는 갱신해야** 한다. 안 그러면 blank를 사이에 둔
    같은 낱말이 다시 붙는다.

그래서 그런 배치가 일부러 섞이도록 판을 만든다.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ml.signbridge.metrics import ctc_greedy_decode  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]

NODE_SCRIPT = """
import { readFileSync } from 'node:fs'
const { greedyDecode } = await import(process.argv[3])

const payload = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const labels = payload.labels
const out = payload.cases.map((c) => {
  const logits = Float32Array.from(c.logits)
  return greedyDecode(logits, c.steps, c.classes, payload.blank, labels).map((t) => t.index)
})
process.stdout.write(JSON.stringify(out))
"""


def make_cases(count: int, seed: int) -> list[dict]:
    """일부러 어려운 판을 섞는다 — 같은 글자 반복·blank 사이끼움·전부 blank."""
    rng = np.random.default_rng(seed)
    cases: list[dict] = []
    for i in range(count):
        classes = int(rng.integers(3, 12))
        steps = int(rng.integers(1, 40))
        logits = rng.normal(size=(steps, classes)).astype(np.float32)

        mode = i % 4
        if mode == 1:
            # 같은 글자를 길게 이어 붙인다 — 중복 축약이 도는지 본다.
            pick = int(rng.integers(1, classes))
            logits[:, pick] += 5.0
        elif mode == 2:
            # 같은 글자 → blank → 같은 글자. **두 번 나와야 맞다.**
            pick = int(rng.integers(1, classes))
            half = max(1, steps // 3)
            logits[:half, pick] += 5.0
            logits[half : half * 2, 0] += 5.0
            logits[half * 2 :, pick] += 5.0
        elif mode == 3:
            # 전부 blank — 빈 결과가 나와야 한다.
            logits[:, 0] += 8.0

        cases.append(
            {
                "steps": steps,
                "classes": classes,
                "logits": [float(x) for x in logits.reshape(-1)],
            }
        )
    return cases


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cases", type=int, default=200)
    ap.add_argument("--seed", type=int, default=0)
    a = ap.parse_args()

    cases = make_cases(a.cases, a.seed)
    max_classes = max(c["classes"] for c in cases)
    labels = ["<blank>"] + [f"글로스{i}" for i in range(1, max_classes)]

    expected: list[list[int]] = []
    for c in cases:
        logits = torch.tensor(c["logits"], dtype=torch.float32).reshape(c["steps"], c["classes"])
        log_probs = torch.log_softmax(logits, dim=-1).unsqueeze(0)
        lengths = torch.tensor([c["steps"]])
        expected.append(ctc_greedy_decode(log_probs, lengths, blank=0)[0])

    with tempfile.TemporaryDirectory() as tmp:
        payload_path = Path(tmp) / "cases.json"
        payload_path.write_text(
            json.dumps({"cases": cases, "labels": labels, "blank": 0}), encoding="utf-8"
        )
        # **저장소 안에** 둔다 — 임시 폴더에 두면 상대 import가 저장소 밖을 가리킨다.
        script_path = REPO_ROOT / "scripts" / ".ctc_parity_run.mjs"
        script_path.write_text(NODE_SCRIPT, encoding="utf-8")
        proc = subprocess.run(
            [
                "node",
                "--experimental-strip-types",
                "--import",
                "./scripts/ts-register.mjs",
                str(script_path),
                str(payload_path),
                str(REPO_ROOT / "src" / "recognition" / "ctcRecognizer.ts"),
            ],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
        )
    script_path.unlink(missing_ok=True)
    if proc.returncode != 0:
        print(proc.stderr[-2000:])
        return 1
    actual = json.loads(proc.stdout)

    mismatch = [i for i, (x, y) in enumerate(zip(expected, actual)) if x != y]
    lengths = [len(x) for x in expected]
    print(f"[ctc-parity] 판 {len(cases)}개 · 글로스 평균 {np.mean(lengths):.1f}개")
    print(f"[ctc-parity] 빈 결과 {sum(1 for x in expected if not x)}판 (전부 blank인 판이 섞여 있다)")
    if mismatch:
        print(f"[ctc-parity] ✗ 다른 판 {len(mismatch)}개 — 앞 3개")
        for i in mismatch[:3]:
            print(f"    판{i}  파이썬 {expected[i]}")
            print(f"          브라우저 {actual[i]}")
        return 1
    print("[ctc-parity] ✓ 파이썬과 브라우저 디코딩이 모든 판에서 같습니다")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/bin/bash
# 연속 인식(CTC) 모델을 앱에 붙인다.
#
#     bash ml/jobs/deploy_ctc.sh ~/sbruns/ctc-v1
#
# 낱말 모델(`deploy_model.sh`)과 나란히 두는 별도 스크립트다. 둘은 파일 위치도
# 규격 검사도 다르다 — 한 스크립트에 합치면 어느 쪽을 갈아 끼웠는지 헷갈린다.
#
# **화면상 정상인데 옛 모델이 도는** 사고를 막으려고 붙인 뒤에 수치를 찍는다.
# (실측: 60에폭을 돌리는 동안 앱에는 에폭 27짜리가 붙어 있었고 아무도 몰랐다.)
set -euo pipefail
cd "$(dirname "$0")/../.."

RUN=${1:?사용법: deploy_ctc.sh <학습 디렉터리(예: ~/sbruns/ctc-v1)>}
OUT="$RUN/onnx-deploy"
DEST=public/models/ksl-ctc

python -m ml.export_onnx --checkpoint "$RUN/best.pt" --out "$OUT"

mkdir -p "$DEST"
cp "$OUT/model.onnx" "$OUT/meta.json" "$DEST/"

python3 - <<'PY'
import json
meta = json.load(open('public/models/ksl-ctc/meta.json', encoding='utf-8'))
if meta.get('task') != 'ctc':
    raise SystemExit(f"[deploy] ✗ CTC 모델이 아닙니다 (task={meta.get('task')})")
wer = meta.get('val_wer')
print(f"[deploy] 앱에 붙은 연속 인식 모델")
print(f"[deploy] 클래스 {meta.get('num_classes'):,}종 · 에폭 {meta.get('trained_epoch')}"
      + (f" · 검증 WER {wer:.4f}" if isinstance(wer, (int, float)) else " · WER 미기록"))
print("[deploy] 이 수치를 보고서·발표 자료의 정확도와 맞추세요.")
PY

# ── 디코딩이 파이썬과 같은지 먼저 본다. 다르면 WER는 좋은데 화면의 자막만 틀린다.
echo "[deploy] 디코딩 대조 (파이썬 == 브라우저)"
python -m ml.tools.ctc_parity --cases 500

echo "[deploy] 다음: npm run build && python3 scripts/e2e_app.py"

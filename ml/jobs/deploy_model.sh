#!/bin/bash
# 학습된 인식 모델을 브라우저용으로 내보내 앱에 붙인다.
#
#     bash ml/jobs/deploy_model.sh ~/sbruns/iso-v2
#
# **왜 스크립트로 두나.** 학습은 60에폭을 도는데 앱에 붙어 있는 건 **에폭 27짜리**였다.
# 아무도 눈치채지 못한 이유는 화면상 아무 차이가 없기 때문이다 — 인식이 조금 더
# 틀릴 뿐이다. 학습이 끝나면 이 한 줄로 갈아 끼운다.
#
# 붙인 뒤에는 meta.json의 val_top1을 **보고서·발표에 쓰는 수치와 맞춰야 한다.**
# 다른 모델의 숫자를 말하면 그건 측정한 것이 아니다.
set -euo pipefail
cd "$(dirname "$0")/../.."

RUN=${1:?사용법: deploy_model.sh <학습 디렉터리(예: ~/sbruns/iso-v2)>}
OUT="$RUN/onnx-deploy"

python -m ml.export_onnx --checkpoint "$RUN/best.pt" --out "$OUT"
cp "$OUT/model.onnx" "$OUT/meta.json" public/models/ksl-iso/

python3 - <<'PY'
import json
meta = json.load(open('public/models/ksl-iso/meta.json', encoding='utf-8'))
keep = {k: v for k, v in meta.items() if k not in ('labels', 'itos')}
print(f"[deploy] 앱에 붙은 모델: {keep}")
print(f"[deploy] 클래스 {meta.get('num_classes'):,}종 · 검증 top1 {meta.get('val_top1', 0):.4f}")
print("[deploy] 이 수치를 보고서·발표 자료의 정확도와 맞추세요.")
PY

echo "[deploy] 다음: npm run build && python3 scripts/e2e_app.py"

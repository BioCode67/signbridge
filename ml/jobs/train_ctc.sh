#!/usr/bin/env bash
# 연속 수어 인식(CTC) 학습 → ONNX 내보내기.
#
# 단어 인식 체크포인트가 있으면 INIT_FROM으로 넘겨 인코더를 물려받는 편이 훨씬 빨리 수렴한다.
#
#     DATA_ROOT=/data/signbridge/ksl \
#     INIT_FROM=/data/runs/isolated-v1/best.pt bash ml/jobs/train_ctc.sh

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
start_job "ctc-${TAG:-v1}"

cd "${REPO_ROOT}"

INIT_ARGS=()
if [[ -n "${INIT_FROM:-}" ]]; then
  INIT_ARGS=(--init-from "${INIT_FROM}")
fi

python -m ml.train_ctc \
  --data "${DATA_ROOT}" \
  --out "${JOB_DIR}" \
  --epochs "${EPOCHS:-80}" \
  --batch-size "${BATCH_SIZE:-16}" \
  --lr "${LR:-3e-4}" \
  --workers "${WORKERS:-6}" \
  --amp bf16 \
  "${INIT_ARGS[@]}" \
  ${EXTRA_ARGS:-} 2>&1 | tee -a "${JOB_LOG}"

python -m ml.export_onnx \
  --checkpoint "${JOB_DIR}/best.pt" \
  --out "${JOB_DIR}/onnx" \
  --quantize 2>&1 | tee -a "${JOB_LOG}"

finish_job

#!/usr/bin/env bash
# 단어(글로스) 단위 수어 인식 학습 → ONNX 내보내기까지.
#
# GPU 워크스페이스(h200-mig-1g.35gb)에서 실행한다.
#
#     DATA_ROOT=/data/signbridge/ksl bash ml/jobs/train_isolated.sh

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
start_job "isolated-${TAG:-v1}"

cd "${REPO_ROOT}"

# 메모리(35GB)는 남고 연산이 부족한 MIG 슬라이스라, 배치를 키워 처리량을 버는 쪽이 유리하다.
# GPU 사용률이 낮으면 모델이 아니라 데이터로더가 병목이니 WORKERS를 먼저 올릴 것.
python -m ml.train_isolated \
  --data "${DATA_ROOT}" \
  --out "${JOB_DIR}" \
  --epochs "${EPOCHS:-60}" \
  --batch-size "${BATCH_SIZE:-128}" \
  --lr "${LR:-3e-4}" \
  --workers "${WORKERS:-8}" \
  --amp bf16 \
  ${EXTRA_ARGS:-} 2>&1 | tee -a "${JOB_LOG}"

# 학습이 끝나면 곧바로 브라우저용으로 내보낸다(내보내기 단계에서 깨지는 걸 늦게 알면 손해).
python -m ml.export_onnx \
  --checkpoint "${JOB_DIR}/best.pt" \
  --out "${JOB_DIR}/onnx" \
  --quantize 2>&1 | tee -a "${JOB_LOG}"

finish_job

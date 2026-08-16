#!/usr/bin/env bash
# AI Hub 원본 영상 → MediaPipe 랜드마크 팩 → 분할·사전 생성.
#
# ★ CPU 워크스페이스에서 돌릴 것. MediaPipe는 GPU를 쓰지 않으므로, GPU 워크스페이스에서
#   돌리면 하나뿐인 GPU 할당량을 며칠간 놀린 채 점유하게 된다.
#
#     RAW_ROOT=/data/raw/aihub DATA_ROOT=/data/signbridge/ksl bash ml/jobs/etl_mediapipe.sh

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
start_job "etl-mediapipe"

VIDEOS="${VIDEOS:-${RAW_ROOT}/원천데이터}"
LABELS="${LABELS:-${RAW_ROOT}/라벨링데이터}"
# 16 vCPU 기준 14개. 나머지는 OS·IO에 남긴다.
WORKERS="${WORKERS:-14}"
# 1=모든 프레임. 2로 두면 30fps→15fps로 추출 시간이 절반이 된다(수어 인식엔 대개 충분).
EVERY="${EVERY:-1}"

cd "${REPO_ROOT}"

# --resume 덕분에 중단 후 다시 실행하면 이미 만든 팩은 건너뛴다.
python -m ml.etl.extract_mediapipe \
  --videos "${VIDEOS}" \
  --labels "${LABELS}" \
  --out "${DATA_ROOT}" \
  --workers "${WORKERS}" \
  --every "${EVERY}" \
  --resume 2>&1 | tee -a "${JOB_LOG}"

python -m ml.etl.prepare \
  --data "${DATA_ROOT}" \
  --split-by signer \
  --min-count "${MIN_COUNT:-5}" 2>&1 | tee -a "${JOB_LOG}"

finish_job

#!/usr/bin/env bash
#PBS -N signbridge-extract
#PBS -l nodes=1:ppn=8
#PBS -j oe
#
# HPC 이노베이션 허브(cloud.openhpc.or.kr)에서 MediaPipe 추출을 **여러 VM에 나눠** 돌린다.
#
# 왜 여기서 돌리나: 추출은 순수 CPU 작업인데 AI Cloud의 GPU 할당량은 1개뿐이다.
# HPC VM은 Xeon Gold 6140 8~16코어를 여러 대 만들 수 있으므로, 추출을 이쪽으로 넘기면
# AI Cloud의 H200을 학습에만 쓸 수 있다.
#
# HPC에서 VM을 2대 이상 만들면 PBS Torque와 passwordless SSH가 자동 구성된다.
#
# 제출 예 (VM 4대에 나누는 경우):
#   for i in 0 1 2 3; do
#     qsub -v SHARD=$i,NUM_SHARDS=4 ml/jobs/pbs_extract.sh
#   done
#
# 전부 끝나면 인덱스를 합친다:
#   python -m ml.etl.merge_index --data "$DATA_ROOT"

set -euo pipefail

cd "${PBS_O_WORKDIR:-$(pwd)}"
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

SHARD="${SHARD:-0}"
NUM_SHARDS="${NUM_SHARDS:-1}"
start_job "extract-shard${SHARD}"

VIDEOS="${VIDEOS:-${RAW_ROOT}/원천데이터}"
LABELS="${LABELS:-${RAW_ROOT}/라벨링데이터}"
# HPC VM은 8코어 사양이 기본이라 워커를 6개로 잡는다(나머지는 OS·IO 몫).
WORKERS="${WORKERS:-6}"
EVERY="${EVERY:-1}"

cd "${REPO_ROOT}"

python -m ml.etl.extract_mediapipe \
  --videos "${VIDEOS}" \
  --labels "${LABELS}" \
  --out "${DATA_ROOT}" \
  --workers "${WORKERS}" \
  --every "${EVERY}" \
  --num-shards "${NUM_SHARDS}" \
  --shard "${SHARD}" \
  --resume 2>&1 | tee -a "${JOB_LOG}"

finish_job

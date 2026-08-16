#!/usr/bin/env bash
# 잡 스크립트 공통 설정.
#
# 경로를 환경변수로 빼 둔 이유: KOREN 워크스페이스마다 볼륨 마운트 지점이 다를 수 있고,
# 로컬에서 시험할 때도 같은 스크립트를 쓸 수 있어야 하기 때문이다.
#
#     DATA_ROOT=/data/signbridge/ksl bash ml/jobs/train_isolated.sh

set -euo pipefail

# 원본(AI Hub 다운로드본) — 팩을 만든 뒤에는 지워도 된다.
export RAW_ROOT="${RAW_ROOT:-/data/raw/aihub}"
# 팩·인덱스·사전 — 오래 남길 것.
export DATA_ROOT="${DATA_ROOT:-/data/signbridge/ksl}"
# 체크포인트·로그 — 반드시 볼륨 안이어야 한다(컨테이너는 휘발성).
export RUNS_ROOT="${RUNS_ROOT:-/data/runs}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export REPO_ROOT
export PYTHONPATH="${REPO_ROOT}:${PYTHONPATH:-}"

# 잡 이름별 로그 디렉터리를 만들고 stdout/stderr을 모두 남긴다.
# 세션이 끊겨도 나중에 진행 상황을 확인할 수 있어야 한다.
start_job() {
  local name="$1"
  export JOB_DIR="${RUNS_ROOT}/${name}"
  mkdir -p "${JOB_DIR}"
  export JOB_LOG="${JOB_DIR}/job.log"
  echo "[job] ${name} 시작 $(date '+%F %T')" | tee -a "${JOB_LOG}"
  echo "[job] REPO=${REPO_ROOT} DATA=${DATA_ROOT} OUT=${JOB_DIR}" | tee -a "${JOB_LOG}"
}

finish_job() {
  echo "[job] 종료 $(date '+%F %T')" | tee -a "${JOB_LOG}"
}

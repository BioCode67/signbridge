#!/usr/bin/env bash
# AI Hub「재난 안전 정보 전달을 위한 수어영상 데이터」(datasetkey 636)
# 라벨링데이터 → 팩 → 학습 준비까지.
#
#   export AIHUB_APIKEY=<AI Hub 마이페이지에서 발급한 키>
#   bash ml/jobs/run_disaster.sh pilot     # 검증셋 11GB — 먼저 이것부터
#   bash ml/jobs/run_disaster.sh full      # 학습셋 90GB — pilot이 통과한 뒤에
#   bash ml/jobs/run_disaster.sh script    # 수어스크립트 372MB — 키포인트 불필요(③단계용)
#
# ── 실제 파일 목록 (2026-08 확인, aihubshell -mode l -datasetkey 636)
#   Training   1.키포인트(xml)_TL          52 GB   61894   ← 안 씀(형태소 JSON에 이미 있음)
#   Training   2.형태소_비수지(json)_TL    90 GB   61895   ← 본 학습 데이터
#   Training   수어스크립트_TL            372 MB   61896   ← 라벨 텍스트만
#   Validation 2.형태소_비수지(json)_VL    11 GB   62028   ← 파일럿
#
# 원천데이터(.mp4)는 합계 2TB가 넘는데 받지 않는다. 키포인트가 형태소 JSON 안에 있다.

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${HERE}/koren_paths.sh"
source "${HERE}/common.sh"

export PATH="$HOME/.local/bin:$PATH"

STAGE="${1:-pilot}"
case "${STAGE}" in
  pilot)  FILEKEY=62028; LABEL="검증셋 형태소 JSON (11GB)" ;;
  full)   FILEKEY=61895; LABEL="학습셋 형태소 JSON (90GB)" ;;
  script) FILEKEY=61896; LABEL="수어스크립트 (372MB)" ;;
  *) echo "stage는 pilot | full | script 중 하나"; exit 1 ;;
esac

: "${AIHUB_APIKEY:?AIHUB_APIKEY 환경변수가 필요합니다 (AI Hub 마이페이지 → API 키)}"

RAW_DIR="${RAW_ROOT}/disaster-${STAGE}"
mkdir -p "${RAW_DIR}" "${DATA_ROOT}"

# /tmp는 컨테이너 디스크라 넉넉하지만 재시작하면 사라진다. 압축을 풀면 원본의
# 3~5배로 불어나므로 받기 전에 여유부터 본다.
FREE_GB=$(df -BG --output=avail "${RAW_ROOT}" | tail -1 | tr -dc '0-9')
echo "── ${LABEL} / 내려받을 곳 ${RAW_DIR} (여유 ${FREE_GB}G)"

echo "── 1. 내려받기"
( cd "${RAW_DIR}" && aihubshell -mode d -datasetkey 636 -filekey "${FILEKEY}" )

echo "── 2. 압축 풀기"
find "${RAW_DIR}" -name '*.zip' -print0 | while IFS= read -r -d '' z; do
  unzip -oq "$z" -d "${z%.zip}" && rm -f "$z"   # 푼 뒤 zip은 지운다(디스크 절약)
done

echo "── 3. 구조 확인 — 여기서 이상하면 아래로 진행하지 말 것"
python3 "${REPO_ROOT}/ml/tools/schema_report.py" "${RAW_DIR}" --limit 3

if [ "${STAGE}" = "script" ]; then
  echo "수어스크립트는 키포인트가 없으므로 여기까지. ③ 글로스↔한국어 학습에 쓴다."
  exit 0
fi

echo "── 4. 팩 만들기 → ${DATA_ROOT}"
python -m ml.etl.aihub_disaster --input "${RAW_DIR}" --out "${DATA_ROOT}" --workers 16

echo "── 5. 수어자 분리 분할"
python -m ml.etl.prepare --data "${DATA_ROOT}" --split-by signer --min-count 5

echo
echo "끝. 어휘 규모부터 확인하세요:  cat ${DATA_ROOT}/stats.json"

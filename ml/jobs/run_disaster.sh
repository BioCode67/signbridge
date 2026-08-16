#!/usr/bin/env bash
# AI Hub「재난 안전 정보 전달을 위한 수어영상 데이터」(datasetkey 636)
# 라벨링데이터 → 팩 → 학습 준비까지.
#
#   export AIHUB_APIKEY=<AI Hub 마이페이지에서 발급한 키>
#   bash ml/jobs/run_disaster.sh pilot     # 검증셋 11GB — 먼저 이것부터
#   bash ml/jobs/run_disaster.sh full      # 학습셋 90GB — pilot이 통과한 뒤에
#   bash ml/jobs/run_disaster.sh script    # 수어스크립트 372MB — 키포인트 없이 ③단계용
#
# ── 실제 파일 목록 (2026-08 확인, aihubshell -mode l -datasetkey 636)
#   Training   1.키포인트(xml)_TL          52 GB   61894   ← 안 받음(형태소 JSON에 이미 있음)
#   Training   2.형태소_비수지(json)_TL    90 GB   61895   ← 본 학습 데이터
#   Training   수어스크립트_TL            372 MB   61896   ← 라벨 텍스트만
#   Validation 2.형태소_비수지(json)_VL    11 GB   62028   ← 파일럿
#
# 원천데이터(.mp4)는 합계 2TB가 넘는데 받지 않는다. 키포인트가 형태소 JSON 안에 있다.
#
# **zip을 풀지 않는다.** ETL이 zip을 연 채로 JSON 멤버만 꺼내 읽는다(디스크 수백 GB 절약).
# 푼 결과와 완전히 같은 팩이 나오는 것은 검증했다(index 동일, 배열 오차 0).
#
# ── 내려받는 도중에는 용량이 한때 3배까지 부푼다 (aihubshell 내부 동작)
#   ① download.tar 수신                     90G
#   ② tar -xvf → 분할 조각(.part) 풀기     +90G = 180G
#   ③ 조각 병합해 zip 복원                 +90G = 270G  ← 최대
#   ④ 조각 삭제 → 180G, download.tar 삭제 → 90G(zip만 남음)
# 그래서 NEED는 최종 90G가 아니라 그 3배 남짓으로 잡는다. 공식 가이드도
# "다운로드 받을 데이터의 2~3배 이상의 용량을 확보"하라고 안내한다.

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${HERE}/koren_paths.sh"
source "${HERE}/common.sh"

export PATH="$HOME/.local/bin:$PATH"

STAGE="${1:-pilot}"
case "${STAGE}" in
  # NEED는 **내려받는 중 한때 필요한 최대치**다(아래 주석 참고). 최종 점유량이 아니다.
  pilot)  FILEKEY=62028; LABEL="검증셋 형태소 JSON (11GB)";  NEED=45 ;;
  full)   FILEKEY=61895; LABEL="학습셋 형태소 JSON (90GB)";  NEED=320 ;;
  script) FILEKEY=61896; LABEL="수어스크립트 (372MB)";       NEED=5 ;;
  *) echo "stage는 pilot | full | script 중 하나"; exit 1 ;;
esac

: "${AIHUB_APIKEY:?AIHUB_APIKEY 환경변수가 필요합니다 (AI Hub 마이페이지 → API 키)}"

command -v aihubshell >/dev/null || {
  echo "aihubshell이 없습니다. 설치:"
  echo "  mkdir -p ~/.local/bin && curl -sS -o ~/.local/bin/aihubshell https://api.aihub.or.kr/api/aihubshell.do && chmod +x ~/.local/bin/aihubshell"
  exit 1
}

sb_require_space "${NEED}"

RAW_DIR="${RAW_ROOT}/disaster-${STAGE}"
mkdir -p "${RAW_DIR}" "${DATA_ROOT}"

echo "── ${LABEL} → ${RAW_DIR}"

echo "── 1. 내려받기 (오래 걸립니다. 끊기면 같은 명령으로 이어받기)"
( cd "${RAW_DIR}" && aihubshell -mode d -datasetkey 636 -filekey "${FILEKEY}" )

echo "── 2. 구조 확인 — 여기서 이상하면 아래로 진행하지 말 것"
python3 "${REPO_ROOT}/ml/tools/schema_report.py" "${RAW_DIR}" --limit 3

if [ "${STAGE}" = "script" ]; then
  echo "수어스크립트는 키포인트가 없으므로 여기까지. ③ 글로스↔한국어 학습에 쓴다."
  exit 0
fi

echo "── 3. 팩 만들기 (zip에서 직접 읽음) → ${DATA_ROOT}"
python -m ml.etl.aihub_disaster --input "${RAW_DIR}" --out "${DATA_ROOT}" --workers 16

echo "── 4. 수어자 분리 분할"
python -m ml.etl.prepare --data "${DATA_ROOT}" --split-by signer --min-count 5

echo
echo "끝. 어휘 규모부터 확인하세요:  cat ${DATA_ROOT}/stats.json"

#!/usr/bin/env bash
#PBS -N signbridge-slconvert
#PBS -l nodes=1:ppn=8
#PBS -j oe
#
# HPC 이노베이션 허브에서 수어영상 키포인트 → 팩 변환을 **여러 VM에 나눠** 돌린다.
#
# 무엇을 변환하나 (둘 중 환경변수 KIND로 선택):
#   KIND=WORD  남은 각도(U/D/L/R) 48,000클립 — 다각도 학습으로 인식 강건성↑
#   KIND=SEN   문장 단위 클립 — 연속 수어 인식(CTC)의 추가 학습 데이터
#
# 왜 HPC인가: 이 변환은 순수 CPU 작업(프레임 JSON 파싱·위생검사·압축)이다.
# AI Cloud의 vCPU 16개로 12,000클립에 약 40분 — 5배 규모를 AI Cloud에서 돌리면
# 그 시간 동안 GPU가 논다. HPC VM 4대(8코어×4)면 같은 일이 1/4 시간에 끝나고,
# 산출물(팩)은 클립당 수십 KB라 AI Cloud로 옮기는 비용이 거의 없다.
#
# 준비(각 VM 공통, 한 번만):
#   1) aihubshell 설치 + AIHUB_APIKEY 설정 → 키포인트 zip을 HPC 스토리지로 받는다
#      (원본 zip은 HPC에 두고 팩만 반출한다 — "무거운 건 제자리, 가벼운 것만 이동")
#   2) unzip으로 해제 (수어영상 키포인트 zip은 표준 zip이다 — 재난안전의 7z 위장과 다름)
#   3) python3 -m pip install numpy
#
# 제출 예 (VM 4대):
#   for i in 0 1 2 3; do
#     qsub -v SHARD=$i,NUM_SHARDS=4,KIND=WORD,ANGLES=U,D,L,R ml/jobs/pbs_slconvert.sh
#   done
#
# 끝나면 팩 디렉터리를 AI Cloud로 복사한 뒤 index를 합친다:
#   python -m ml.etl.merge_index --data <합칠 디렉터리>

set -euo pipefail
cd "${PBS_O_WORKDIR:-$(pwd)}"

KIND="${KIND:-WORD}"
ANGLES="${ANGLES:-U,D,L,R}"
SHARD="${SHARD:-0}"
NUM_SHARDS="${NUM_SHARDS:-1}"
KP_ROOT="${KP_ROOT:-$HOME/sl-kp}"          # 키포인트 해제 루트
MORPH_ROOT="${MORPH_ROOT:-$HOME/sl-morph}" # 형태소 해제 루트
OUT="${OUT:-$HOME/sl-pack-$KIND-$SHARD}"

python3 -m ml.etl.aihub_sl \
  --keypoints "$KP_ROOT" \
  --morpheme "$MORPH_ROOT" \
  --out "$OUT" \
  --kinds "$KIND" \
  --angles "$ANGLES" \
  --shard "$SHARD" --num-shards "$NUM_SHARDS" \
  --workers 8

echo "[pbs] shard $SHARD/$NUM_SHARDS 완료 → $OUT"

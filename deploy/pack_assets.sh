#!/usr/bin/env bash
# HF Spaces에 올릴 자산(모델·동작사전)을 tar.gz로 묶는다.
#
#   bash deploy/pack_assets.sh
#
# 결과는 ~/deploy/ 에 떨어진다. 워크스페이스 파일 브라우저로 내려받아
# HF **데이터셋 저장소**에 업로드하면 된다(Space 저장소가 아니다 — Space는 코드용,
# 대용량 파일은 데이터셋 쪽이 맞다).
#
# 아카이브 최상위가 곧 대상 디렉터리 내용이어야 한다(`-C <경로> .`). fetch_assets.py가
# 그 전제로 푼다.

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${HERE}/../ml/jobs/koren_paths.sh"

OUT="${OUT:-$HOME/deploy}"
T2G="${T2G:-$HOME/sbruns/t2g-v3/best}"
BANK="${BANK:-$HOME/sbdata/glossbank}"

mkdir -p "${OUT}"

echo "── 1. text2gloss 모델"
if [ -d "${T2G}" ]; then
  # 학습 중 남는 옵티마이저 상태 등은 추론에 불필요하므로 제외한다.
  tar czf "${OUT}/t2g-best.tar.gz" -C "${T2G}" \
      --exclude='optimizer.pt' --exclude='scheduler.pt' --exclude='rng_state*' .
  echo "   → ${OUT}/t2g-best.tar.gz ($(du -h "${OUT}/t2g-best.tar.gz" | cut -f1))"
else
  echo "   ⚠️ 없음: ${T2G}"
fi

echo "── 2. 글로스 동작 사전"
if [ -f "${BANK}/bank.json" ]; then
  tar czf "${OUT}/glossbank.tar.gz" -C "${BANK}" .
  echo "   → ${OUT}/glossbank.tar.gz ($(du -h "${OUT}/glossbank.tar.gz" | cut -f1))"
  python3 -c "
import json;b=json.load(open('${BANK}/bank.json'))
n3=sum(1 for v in b.values() if v.get('has3d'))
print(f'   글로스 {len(b):,}종 (3D 포함 {n3:,}종)')"
else
  echo "   ⚠️ 아직 구축 중이거나 없음: ${BANK}"
fi

echo
echo "다음: HF 데이터셋 저장소에 업로드 → Space Variables에 직링크 입력"
echo "  T2G_MODEL_URL  = https://huggingface.co/datasets/<계정>/signbridge-assets/resolve/main/t2g-best.tar.gz"
echo "  GLOSS_BANK_URL = https://huggingface.co/datasets/<계정>/signbridge-assets/resolve/main/glossbank.tar.gz"

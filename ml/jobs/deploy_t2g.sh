#!/bin/bash
# 학습된 소형 번역 모델을 앱에 붙인다.
#
#     bash ml/jobs/deploy_t2g.sh ~/sbruns/t2gs-v1
#
# **왜 스크립트로 두나.** 모델을 갈아 끼우는 일은 단계가 여럿이고, 하나라도
# 빠지면 **화면상 정상인데 옛 모델이 도는** 상태가 된다(실측: 60에폭을 돌리는
# 동안 앱에는 에폭 27짜리가 붙어 있었고 아무도 몰랐다).
#
# 순서가 중요하다:
#   1) 내보내기 — 정적 모양 + int8
#   2) public/models/t2g 로 옮기기
#   3) 빌드 — 오프라인 매니페스트가 새 파일을 집는다
#   4) 검사 — 음절 규약이 어긋나면 브라우저에서만 엉뚱한 결과가 나온다
set -euo pipefail
cd "$(dirname "$0")/../.."

CK=${1:-$HOME/sbruns/t2gs-v1}
OUT=public/models/t2g

echo "── 1/4 ONNX 내보내기 (정적 모양 + int8)"
python -m ml.export_t2gs_onnx --checkpoint "$CK" --out "$OUT" --quantize

echo "── 2/4 크기 확인"
du -sh "$OUT"
ls -la "$OUT" | awk 'NR>1 {printf "   %8.1fMB  %s\n", $5/1048576, $9}'

echo "── 3/4 빌드 (오프라인 매니페스트가 새 파일을 집는다)"
npm run build

echo "── 4/4 검사"
node --experimental-strip-types --import ./scripts/ts-register.mjs \
  scripts/check_syllable_parity.mjs
node --experimental-strip-types --import ./scripts/ts-register.mjs \
  scripts/check_translation_cases.mjs

echo
echo "다음: python3 scripts/e2e_app.py   # 실기기에서도 한 번 눌러 볼 것"

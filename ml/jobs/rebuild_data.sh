#!/bin/bash
# 웹에 실리는 데이터 전부를 다시 만든다 — 동작 사전 → 번역 사전 → 어순표 → 검증.
#
#     bash ml/jobs/rebuild_data.sh
#
# **순서가 중요하다.** 번역 사전과 어순표는 동작 사전(bank.json)을 보고 만들어진다.
# 동작 사전만 다시 만들고 나머지를 두면, 사라진 글로스를 가리키는 번역이 남아
# **아바타가 조용히 서 있는다**(실측: 상용구 30개 중 17개가 이렇게 죽었다).
#
# 마지막 세 검사는 건너뛰지 말 것:
#   check_app_glosses      앱이 쓰는 글로스가 사전에 실존하는가
#   check_translation_cases 과거에 났던 오역이 되살아나지 않았는가
#   e2e_app                폰·태블릿·키오스크에서 실제로 재생되는가
set -euo pipefail
cd "$(dirname "$0")/../.."

BANK=${BANK:-~/sbdata/glossbank}
SCRIPT=${SCRIPT:-~/sbdata/script}
INDEX=${INDEX:-"$HOME/sbdata/ksl $HOME/sbdata/ksl-slword"}
TOP=${TOP:-10000}

echo "── 1/5 웹 동작 사전 (빈도 상위 $TOP + 생활 어휘 보장)"
# shellcheck disable=SC2086
python -m ml.etl.export_web_bank --bank "$BANK" --index $INDEX \
  --out public/data --top "$TOP" --must ml/data/daily_vocab.txt

echo "── 2/5 번역 사전 (Dice + 표제어 직결 + 활용형)"
python -m ml.etl.build_align_dict --data "$SCRIPT" \
  --out public/data/align.json --vocab public/data/bank.json

echo "── 3/5 어순표 (말뭉치에서 잰 낱말 위치)"
python -m ml.etl.build_order --data "$SCRIPT" \
  --out public/data/order.json --vocab public/data/bank.json

echo "── 4/5 앱 글로스 정합 검사"
python3 ml/tools/check_app_glosses.py

echo "── 5/5 번역 오역 회귀 검사"
node --experimental-strip-types --import ./scripts/ts-register.mjs \
  scripts/check_translation_cases.mjs

echo
echo "다음: npm run build && python3 scripts/e2e_app.py"

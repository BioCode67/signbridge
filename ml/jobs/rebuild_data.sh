#!/bin/bash
# 웹에 실리는 데이터 전부를 다시 만든다 — 동작 사전 → 번역 사전 → 어순표 → 검증.
#
#     bash ml/jobs/rebuild_data.sh
#
# **순서가 중요하다.** 번역 사전과 어순표는 동작 사전(bank.json)을 보고 만들어진다.
# 동작 사전만 다시 만들고 나머지를 두면, 사라진 글로스를 가리키는 번역이 남아
# **아바타가 조용히 서 있는다**(실측: 상용구 30개 중 17개가 이렇게 죽었다).
#
# 마지막 여섯 검사는 건너뛰지 말 것:
#   check_app_glosses      앱이 쓰는 글로스가 사전에 실존하는가
#   check_rule_parity      파이썬과 TS가 같은 조사·어미 규칙을 쓰는가
#   check_translation_cases 과거에 났던 오역이 되살아나지 않았는가
#   check_intent           수어 낱말 묶음이 옳은 의도로 이어지는가(오검출 포함)
#   check_nearby           거리·방위·어림수·답변 문장이 맞는가
#   e2e_app                폰·태블릿·키오스크에서 실제로 재생되는가
set -euo pipefail
cd "$(dirname "$0")/../.."

BANK=${BANK:-~/sbdata/glossbank}
SCRIPT=${SCRIPT:-~/sbdata/script}
INDEX=${INDEX:-"$HOME/sbdata/ksl $HOME/sbdata/ksl-slword"}
TOP=${TOP:-10000}

echo "── 1/7 웹 동작 사전 (빈도 상위 $TOP + 생활 어휘 보장)"
# shellcheck disable=SC2086
python -m ml.etl.export_web_bank --bank "$BANK" --index $INDEX \
  --out public/data --top "$TOP" \
  --must ml/data/daily_vocab.txt ml/data/daily_vocab_aihub.txt

echo "── 2/7 번역 사전 (Dice + 표제어 직결 + 활용형)"
python -m ml.etl.build_align_dict --data "$SCRIPT" \
  --out public/data/align.json --vocab public/data/bank.json

echo "── 3/7 어순표 (말뭉치에서 잰 낱말 위치)"
python -m ml.etl.build_order --data "$SCRIPT" \
  --out public/data/order.json --vocab public/data/bank.json

echo "── 4/7 앱 글로스 정합 검사"
python3 ml/tools/check_app_glosses.py

echo "── 5/7 파이썬↔TS 규칙 대조 (조사·어미·제외어)"
python3 ml/tools/check_rule_parity.py

echo "── 6/7 번역 오역 회귀 검사"
node --experimental-strip-types --import ./scripts/ts-register.mjs \
  scripts/check_translation_cases.mjs

echo "── 7/7 묻기 화면 — 의도 판정 · 길찾기 계산"
node --experimental-strip-types --import ./scripts/ts-register.mjs \
  scripts/check_intent.mjs
node --experimental-strip-types --import ./scripts/ts-register.mjs \
  scripts/check_nearby.mjs

echo
echo "다음: npm run build && python3 scripts/e2e_app.py"

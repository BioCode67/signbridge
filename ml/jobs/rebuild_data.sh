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
#   check_nonmanual        고개 끄덕임·젓기가 합성 결과에 실제로 실리는가
#   e2e_app                폰·태블릿·키오스크에서 실제로 재생되는가
set -euo pipefail
cd "$(dirname "$0")/../.."

BANK=${BANK:-~/sbdata/glossbank}
SCRIPT=${SCRIPT:-~/sbdata/script}
INDEX=${INDEX:-"$HOME/sbdata/ksl $HOME/sbdata/ksl-slword"}
TOP=${TOP:-10000}

echo "── 1/8 웹 동작 사전 (빈도 상위 $TOP + 생활 어휘 보장)"
# shellcheck disable=SC2086
python -m ml.etl.export_web_bank --bank "$BANK" --index $INDEX \
  --out public/data --top "$TOP" \
  --must ml/data/daily_vocab.txt ml/data/daily_vocab_aihub.txt

echo "── 2/8 번역 사전 (Dice + 표제어 직결 + 활용형)"
python -m ml.etl.build_align_dict --data "$SCRIPT" \
  --out public/data/align.json --vocab public/data/bank.json

echo "── 3/8 어순표 (말뭉치에서 잰 낱말 위치)"
python -m ml.etl.build_order --data "$SCRIPT" \
  --out public/data/order.json --vocab public/data/bank.json

echo "── 4/8 앱 글로스 정합 검사"
python3 ml/tools/check_app_glosses.py

echo "── 5/8 파이썬↔TS 규칙 대조 (조사·어미·제외어)"
python3 ml/tools/check_rule_parity.py

echo "── 6/8 번역 오역 회귀 검사"
node --experimental-strip-types --import ./scripts/ts-register.mjs \
  scripts/check_translation_cases.mjs

echo "── 7/8 고개 동작이 합성에 실리는가"
node --experimental-strip-types --import ./scripts/ts-register.mjs \
  scripts/check_nonmanual.mjs

echo "── 8/8 묻기 화면 — 의도 판정 · 길찾기 계산"
node --experimental-strip-types --import ./scripts/ts-register.mjs \
  scripts/check_intent.mjs
node --experimental-strip-types --import ./scripts/ts-register.mjs \
  scripts/check_nearby.mjs

echo
echo "다음: npm run build && python3 scripts/e2e_app.py"

# ── 사전·어순표를 다시 만들면 **번역이 내는 글로스**도 바뀐다. 동작 사전에 없는
# 글로스는 재생 때 조용히 건너뛴다 — 화면은 정상으로 보인다. 문장에서 실제로
# 만들어지는 글로스를 재난문자·측정용 문장 여섯 갈래로 훑어 확인한다.
node --experimental-strip-types --import ./scripts/ts-register.mjs \
     scripts/check_silent_skip.mjs

# 사전을 다시 만들면 화면에 적힌 낱말 수·클래스 수가 낡는다. 오류도 안 나고
# 화면도 멀쩡해서 **틀린 숫자를 그대로 발표하게 된다.** 원본과 대조한다.
node --experimental-strip-types --import ./scripts/ts-register.mjs \
     scripts/check_site_numbers.mjs

# 사전을 다시 만들면 글로스 이름이 그대로 파일명이 된다. 웹에서는 아무 문자나
# 되지만 **윈도우는 `:`를 못 쓴다** — 노트북용 zip이 안 풀린다(2026-08-19 실측).
node scripts/check_filenames.mjs

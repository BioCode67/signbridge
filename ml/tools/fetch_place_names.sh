#!/bin/bash
# 대한민국 **지명**을 OpenStreetMap에서 받는다(키 불필요).
#
#     bash ml/tools/fetch_place_names.sh > /tmp/places.json
#
# **왜 필요한가.** 재난문자에는 지역명이 늘 붙어 있어, 통계 정렬 사전을 만들 때
# 지명이 아무 낱말에나 달라붙는다 — `계곡물 → 도청`, `모든 → 은행1`,
# `세부 → 강동2`, `자택 → 권선`. 실제로 사용자가 화면에서 본 오역들이다.
#
# 지명 목록이 있으면 **"이 글로스는 지명이다"**를 알 수 있고, 한국어 낱말이
# 지명이 아닌데 지명 글로스가 첫 후보로 붙은 자리를 골라낼 수 있다.
set -uo pipefail
Q='[out:json][timeout:300];
area["ISO3166-1"="KR"][admin_level=2]->.kr;
(
  node["place"~"^(city|town|village|suburb|neighbourhood|quarter|hamlet)$"]["name:ko"](area.kr);
  node["place"~"^(city|town|village|suburb|neighbourhood|quarter|hamlet)$"]["name"](area.kr);
  relation["boundary"="administrative"]["admin_level"~"^(4|6|7|8)$"]["name"](area.kr);
);out tags;'
for _ in 1 2 3 4; do
  for M in https://overpass-api.de/api/interpreter \
           https://overpass.kumi.systems/api/interpreter \
           https://overpass.osm.jp/api/interpreter; do
    OUT=$(timeout 320 curl -s -G "$M" --data-urlencode "data=$Q")
    if [ "${OUT:0:1}" = "{" ]; then echo "$OUT"; exit 0; fi
  done
  sleep 15
done
echo "Overpass 응답 없음" >&2; exit 1

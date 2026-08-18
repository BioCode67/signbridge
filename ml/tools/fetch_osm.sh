#!/bin/bash
# OpenStreetMap에서 주변 장소를 받아 온다(키 불필요).
#
#     bash ml/tools/fetch_osm.sh > /tmp/osm.json
#     python3 ml/tools/build_nearby.py --osm /tmp/osm.json
#
# 기본 범위는 수도권이다. 다른 지역은 BBOX를 바꾼다(남위,서경,북위,동경).
# Overpass 공개 서버는 자주 붐빈다 — 미러를 돌아가며 최대 6번 시도한다.
set -uo pipefail
BBOX=${BBOX:-37.42,126.76,37.70,127.18}
Q="[out:json][timeout:180];(
 node[\"amenity\"~\"^(school|hospital|pharmacy|police|toilets)\$\"]($BBOX);
 way[\"amenity\"~\"^(school|hospital|pharmacy|police|toilets)\$\"]($BBOX);
 node[\"railway\"=\"station\"][\"station\"=\"subway\"]($BBOX);
 node[\"emergency\"=\"assembly_point\"]($BBOX);
);out center tags;"
for _ in 1 2 3 4 5 6; do
  for M in https://overpass-api.de/api/interpreter \
           https://overpass.kumi.systems/api/interpreter \
           https://overpass.osm.jp/api/interpreter; do
    OUT=$(timeout 200 curl -s -G "$M" --data-urlencode "data=$Q")
    if [ "${OUT:0:1}" = "{" ]; then echo "$OUT"; exit 0; fi
  done
  sleep 20
done
echo "Overpass 서버가 모두 응답하지 않았다" >&2; exit 1

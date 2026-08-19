#!/bin/bash
# 대한민국 **전국** 장소를 OpenStreetMap에서 받아 하나로 합친다(키 불필요).
#
#     bash ml/tools/fetch_osm_kr.sh > /tmp/osm_kr.json
#     python3 ml/tools/build_nearby.py --osm /tmp/osm_kr.json
#
# 왜 만들었나. `fetch_osm.sh`의 기본 범위가 **수도권뿐**이었다(37.42~37.70).
# 그래서 지방에서 열면 가장 가까운 대피소가 **229km**로 나온다 — 계산은 맞는데
# 데이터가 없는 것이다. 화면은 멀쩡하고 오류도 안 난다.
#
# 전국을 한 번에 물으면 Overpass가 시간 초과로 죽는다. 위도를 띠로 잘라
# 여러 번 묻고 elements를 합친다.
set -uo pipefail
LON_MIN=${LON_MIN:-124.5}
LON_MAX=${LON_MAX:-131.0}
BANDS=${BANDS:-"33.0,34.2 34.2,35.2 35.2,36.2 36.2,37.0 37.0,37.8 37.8,38.7"}

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
i=0
for B in $BANDS; do
  S=${B%,*}; N=${B#*,}
  BBOX="$S,$LON_MIN,$N,$LON_MAX"
  Q="[out:json][timeout:300];(
   node[\"amenity\"~\"^(school|hospital|pharmacy|police|toilets)\$\"]($BBOX);
   way[\"amenity\"~\"^(school|hospital|pharmacy|police|toilets)\$\"]($BBOX);
   node[\"railway\"=\"station\"][\"station\"=\"subway\"]($BBOX);
   node[\"emergency\"=\"assembly_point\"]($BBOX);
  );out center tags;"
  got=""
  for _ in 1 2 3 4; do
    for M in https://overpass-api.de/api/interpreter \
             https://overpass.kumi.systems/api/interpreter \
             https://overpass.osm.jp/api/interpreter; do
      OUT=$(timeout 320 curl -s -G "$M" --data-urlencode "data=$Q")
      if [ "${OUT:0:1}" = "{" ]; then got="$OUT"; break 2; fi
    done
    sleep 15
  done
  if [ -z "$got" ]; then echo "[osm] 띠 $BBOX 실패" >&2; continue; fi
  i=$((i+1)); printf '%s' "$got" > "$TMP/$i.json"
  echo "[osm] 띠 $S~$N 받음 ($(printf '%s' "$got" | wc -c) 바이트)" >&2
done

python3 - "$TMP" <<'PY'
import json, pathlib, sys
d = pathlib.Path(sys.argv[1])
els, seen = [], set()
for f in sorted(d.glob("*.json")):
    try: o = json.loads(f.read_text(encoding="utf-8"))
    except Exception: continue
    for e in o.get("elements", []):
        k = (e.get("type"), e.get("id"))
        if k in seen: continue
        seen.add(k); els.append(e)
print(f"[osm] 합계 {len(els):,}개", file=sys.stderr)
json.dump({"elements": els}, sys.stdout, ensure_ascii=False)
PY

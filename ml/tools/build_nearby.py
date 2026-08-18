#!/usr/bin/env python3
"""주변 장소 목록(`public/data/nearby.json`)을 만든다.

수어로 "대피소 어디?"라고 물었을 때 답할 재료다. 두 갈래 원천을 지원한다.

  1) **행정안전부 표준데이터** (공식) — 공공데이터포털 키가 필요하다.
         python3 ml/tools/build_nearby.py --gov-key <서비스키>
     이때 `official: true`로 표시되고, 앱이 "공식 지정 대피소"라고 안내한다.

  2) **OpenStreetMap** (참고용) — 키 없이 받을 수 있다.
         bash ml/tools/fetch_osm.sh seoul > /tmp/osm.json
         python3 ml/tools/build_nearby.py --osm /tmp/osm.json
     이 경우 `official: false`다. 학교·공원은 실제로 대피소로 지정된 곳이 많지만
     **지정 여부는 OSM이 알지 못한다.** 앱은 이 목록을 "참고용"으로만 표시한다.
     대피소 정보를 사실과 다르게 말하는 것은 정보가 없는 것보다 나쁘다.

두 원천을 함께 주면 공식 목록이 우선하고 OSM은 공식에 없는 갈래(약국·화장실 등)만
채운다.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import urllib.parse
import urllib.request
from pathlib import Path

# OSM 태그 → 앱의 장소 갈래
OSM_KIND = {
    ("amenity", "school"): "shelter",       # 학교 운동장·강당이 국내 대피 장소의 다수
    ("amenity", "hospital"): "hospital",
    ("amenity", "clinic"): "hospital",
    ("amenity", "pharmacy"): "pharmacy",
    ("amenity", "police"): "police",
    ("amenity", "toilets"): "toilet",
    ("emergency", "assembly_point"): "shelter",
    ("railway", "station"): "subway",
}


def from_osm(path: Path) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    out: list[dict] = []
    for el in data.get("elements", []):
        tags = el.get("tags") or {}
        kind = None
        for (k, v), mapped in OSM_KIND.items():
            if tags.get(k) == v:
                kind = mapped
                break
        if kind is None:
            continue
        # 지하철역만 — 일반 철도역까지 넣으면 "지하철 어디"의 답이 틀린다
        if kind == "subway" and tags.get("station") != "subway":
            continue
        lat = el.get("lat") or (el.get("center") or {}).get("lat")
        lon = el.get("lon") or (el.get("center") or {}).get("lon")
        if lat is None or lon is None:
            continue
        # 이름이 없으면 화면에 띄울 것이 없다 — 방향만 알려주면 찾아갈 수 없다
        name = tags.get("name:ko") or tags.get("name")
        if not name:
            continue
        item = {"name": name, "kind": kind,
                "lat": round(float(lat), 5), "lon": round(float(lon), 5)}
        addr = " ".join(x for x in (tags.get("addr:district"), tags.get("addr:street"),
                                    tags.get("addr:housenumber")) if x)
        if addr:
            item["addr"] = addr
        out.append(item)
    return out


GOV_URL = "https://api.odcloud.kr/api/15021098/v1/uddi:"


def from_gov(key: str, pages: int = 40) -> list[dict]:
    """행정안전부 전국 대피소 표준데이터.

    공공데이터포털에서 활용 신청 후 발급받은 **디코딩된** 일반 인증키를 넣는다.
    데이터셋 uddi는 갱신될 때마다 바뀌므로, 실패하면 포털에서 현재 uddi를 확인해
    `--gov-uddi`로 넘긴다.
    """
    out: list[dict] = []
    uddi = from_gov.uddi  # type: ignore[attr-defined]
    for page in range(1, pages + 1):
        q = urllib.parse.urlencode(
            {"page": page, "perPage": 1000, "serviceKey": key})
        url = f"{GOV_URL}{uddi}?{q}"
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                body = json.loads(r.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001
            print(f"  공공데이터 요청 실패(page {page}): {e}", file=sys.stderr)
            break
        rows = body.get("data") or []
        if not rows:
            break
        for row in rows:
            lat = row.get("위도") or row.get("LAT")
            lon = row.get("경도") or row.get("LOT") or row.get("LON")
            name = row.get("시설명") or row.get("대피소명") or row.get("SHLT_NM")
            if not (lat and lon and name):
                continue
            try:
                lat, lon = float(lat), float(lon)
            except (TypeError, ValueError):
                continue
            if not (32 < lat < 40 and 124 < lon < 132):  # 한반도 밖 좌표는 오류다
                continue
            item = {"name": str(name).strip(), "kind": "shelter",
                    "lat": round(lat, 5), "lon": round(lon, 5)}
            addr = row.get("주소") or row.get("도로명주소")
            if addr:
                item["addr"] = str(addr).strip()
            cap = row.get("최대수용인원")
            if cap:
                item["note"] = f"최대 {cap}명"
            out.append(item)
        print(f"  공공데이터 page {page}: 누적 {len(out)}건")
    return out


from_gov.uddi = ""  # type: ignore[attr-defined]


def dedupe(places: list[dict], meters: float = 40.0) -> list[dict]:
    """같은 자리에 같은 갈래가 겹치면 하나만 — OSM은 건물과 노드가 함께 잡힌다."""
    kept: list[dict] = []
    # 100m 격자로 나눠 이웃만 비교한다(전수 비교는 5천 건에서 느리다)
    grid: dict[tuple, list[dict]] = {}
    for p in places:
        gx, gy = int(p["lat"] * 1000), int(p["lon"] * 1000)
        dup = False
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for q in grid.get((gx + dx, gy + dy), []):
                    if q["kind"] != p["kind"]:
                        continue
                    dlat = (p["lat"] - q["lat"]) * 111320
                    dlon = (p["lon"] - q["lon"]) * 111320 * math.cos(math.radians(p["lat"]))
                    if dlat * dlat + dlon * dlon < meters * meters:
                        dup = True
                        break
                if dup:
                    break
            if dup:
                break
        if not dup:
            kept.append(p)
            grid.setdefault((gx, gy), []).append(p)
    return kept


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--osm", type=Path, help="Overpass JSON 파일")
    ap.add_argument("--gov-key", help="공공데이터포털 일반 인증키(디코딩)")
    ap.add_argument("--gov-uddi", default="", help="대피소 표준데이터 uddi")
    ap.add_argument("--out", type=Path, default=Path("public/data/nearby.json"))
    a = ap.parse_args()

    places: list[dict] = []
    official = False
    sources: list[str] = []

    if a.gov_key:
        from_gov.uddi = a.gov_uddi  # type: ignore[attr-defined]
        gov = from_gov(a.gov_key)
        if gov:
            places += gov
            official = True
            sources.append("행정안전부 전국 대피소 표준데이터")
    if a.osm:
        osm = from_osm(a.osm)
        if official:
            # 공식 대피소가 있으면 OSM의 대피소는 버린다 — 지정 여부를 알 수 없으므로
            osm = [p for p in osm if p["kind"] != "shelter"]
        places += osm
        sources.append("OpenStreetMap 기여자 (ODbL)")

    if not places:
        print("장소를 하나도 만들지 못했다 — --osm 또는 --gov-key 를 확인할 것", file=sys.stderr)
        return 1

    before = len(places)
    places = dedupe(places)
    places.sort(key=lambda p: (p["kind"], p["name"]))

    from datetime import date
    out = {
        "official": official,
        "source": " · ".join(sources),
        "updated": date.today().isoformat(),
        "places": places,
    }
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")),
                     encoding="utf-8")

    kinds: dict[str, int] = {}
    for p in places:
        kinds[p["kind"]] = kinds.get(p["kind"], 0) + 1
    print(f"{a.out} — {len(places)}곳 (중복 {before - len(places)}건 제거), "
          f"공식={official}")
    for k, n in sorted(kinds.items(), key=lambda x: -x[1]):
        print(f"  {k:9s} {n}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

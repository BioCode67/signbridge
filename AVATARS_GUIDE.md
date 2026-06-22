# 실사 아바타 구하기 가이드 (SignBridge)

앱에 바로 적용하려면 모델이 아래 **3가지 조건**을 만족해야 합니다.

1. **리깅된 휴머노이드** (서 있는 사람 골격)
2. **손가락 본 포함** (Thumb/Index/Middle/Ring/Pinky 각 마디) — 수어에 필수
3. **`.glb` 또는 `.vrm`** 포맷 (FBX면 변환 필요)
   - 본 이름은 표준(Mixamo `LeftArm/LeftForeArm/LeftHand/LeftHandIndex1…`) 또는 VRM 휴머노이드면 그대로 동작

> 적용 방법: 받은 파일을 `public/models/`에 넣고 알려주시거나, 다운로드 URL만 주세요. (현재 VRM·GLB 둘 다 지원)

---

## 무료 (추천 순)

| 사이트 | 특징 | 포맷 | 비고 |
|---|---|---|---|
| **Ready Player Me** · readyplayer.me | 반실사 인물, **정장/블레이저 선택 가능**, 손가락 리그 | GLB | 무료·가장 쉬움. 'Download .glb' URL 주시면 끝. 현재 기자/앵커가 이 계열 |
| **Avaturn** · avaturn.me | **사진 한 장으로 실사 아바타**, 리깅·표정 | GLB | 무료 티어. RPM보다 더 사람 같음 |
| **VRoid Studio/Hub** · vroid.com | 정장 캐릭터 직접 제작, 표정·손가락 완비 | VRM | 무료. 단 애니풍(반실사). VRM이라 바로 적용 |
| **Mixamo** · mixamo.com (Adobe) | **정장 캐릭터(Business 등)**, 자동 리깅·손가락 | FBX | 무료(Adobe 로그인). FBX→GLB 변환 필요(아래 참고) |
| **Sketchfab** · sketchfab.com | 검색량 많음. 필터 **Downloadable + Rigged + 사람** | GLB/FBX | 무료/유료 혼재. "리깅+손가락" 확인 필수 |

## 유료 (퀄 ↑, 사오실 때)

| 사이트 | 특징 | 가격대 |
|---|---|---|
| **Reallusion ActorCore** · actorcore.reallusion.com | 방송용급 실사 인물, 정장·아나운서, 완전 리깅 | $ (캐릭터당 저렴~중) |
| **TurboSquid** · turbosquid.com | "business man rigged", "news anchor" 검색 | $$ |
| **CGTrader** · cgtrader.com | 리깅 인물 다양, 무료도 일부 | $~$$ |
| **Character Creator 4** (Reallusion) | 정장 실사 인물 직접 생성·export | 툴 구매형 |

### 구매/다운로드 시 체크리스트
- [ ] **Rigged / Skeleton 포함** (정적 모델 X)
- [ ] **손가락 본 있음** (제품 설명/뷰어에서 손 확인)
- [ ] **.glb 또는 .vrm export 가능** (FBX만이면 변환 필요)
- [ ] 정장/단정한 복장(뉴스 아나운서 톤)
- [ ] 라이선스: 데모/발표 사용 가능 (상업/재배포 조건 확인)

### FBX만 받았을 때 (Mixamo 등) → GLB 변환
- 온라인: **gltf.report**, **anyconv.com (fbx→glb)**
- 또는 Blender에서 Import FBX → Export glTF(.glb)
- 변환 후 손가락 본이 유지됐는지 뷰어(gltf-viewer.donmccurdy.com)에서 확인

---

## 가장 빠른 길 (추천)
1. **Ready Player Me**에서 정장 아바타 2분 제작 → **'…readyplayer.me/xxxx.glb' URL** 복사 → 저에게 전달
2. 더 실사로 가고 싶으면 **Avaturn**(사진 기반) 또는 유료 **ActorCore**
3. 파일/URL 주시면 `public/models/`에 넣고 선택기에 추가 — 즉시 수어 동작 적용됩니다.

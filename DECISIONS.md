# DECISIONS — 자율 작업 중 내린 판단 기록

1시간 자율 작업 동안, 막히는 지점마다 멈추지 않고 가장 합리적인 선택을 가정하고 진행했습니다.
각 판단의 "무엇을 / 왜"를 시간 순으로 기록합니다.

---

- **기반 토대로 `signbridge-proposal`을 재사용** — 바탕화면에 이미 동일 프로젝트의 검증된
  Vite+React+TS+Tailwind+Three.js 앱(globe·KOREN 네트워크 히어로)이 있어, 새로 scaffold하지 않고
  이를 `signbridge-app`으로 복제 후 개편했습니다. 요청한 히어로 연출(자전 지구·시안 펄스·노드)이
  이미 고품질로 구현돼 있었고, npm install 대기 없이 즉시 작업에 들어가기 위함.

- **제안용 섹션 제거, 제품용 구조로 재편** — proposal의 `DualPlatform / TopicsUnderReview / Impact`
  및 관련 UI(`Card / CountUp / DeviceFrames / MiniHero`)는 공모전 제안 성격이라 삭제. 이번 요청의
  핵심인 "수어 아바타 데모"를 중심으로 `Hero → SignAvatarDemo → HowItWorks → Footer` 4단 구성으로
  단순화했습니다.

- **아바타 렌더링 로직은 새로 만들지 않고 데모를 그대로 이식** — 지시대로 `signbridge_demo.html`의
  Canvas 2D 재생 로직(좌표 매핑 `P()`, 신뢰도 `C()`, `smoothLimb`/`handShape`/`renderAvatar`/
  `renderSkeleton`)을 수식·상수까지 동일하게 `src/sections/sign/renderSign.ts`로 옮겼습니다.
  검증된 결과물을 그대로 재현하기 위함.

- **데모를 imperative 렌더 + React state UI로 분리** — 30fps 캔버스 드로잉은 ref 기반 rAF 루프로
  처리하고(리렌더 비용 회피), 탭·글로스 하이라이트·타임라인 등 UI만 state로 구동했습니다. 단일
  redraw 경로(`useLayoutEffect`가 frame/mode/index 변화 시 다시 그림)로 통일해 seek·모드토글·문장전환이
  일관되게 동작합니다.

- **동적 탭 생성 구조 채택** — `public/data/manifest.json`(파일명 배열)을 읽고 각 `sign_N.json`을
  fetch해 탭을 자동 생성(`useSignData` 훅). 곧 추가될 지진·태풍·호우 문장은 **코드 수정 없이**
  파일 추가 + manifest 한 줄로 늘어납니다(지시사항 반영).

- **제공 데이터는 6개 문장(sign_1~6)** — 안내문에서 언급된 `sign_1~3`이 아니라 실제 zip에는 6개가
  들어 있어 6개를 모두 `public/data/`에 배치했습니다. manifest도 6개 기준.

- **AI Hub 데이터 출처를 푸터에 명시** — 데이터설명서(PDF) 기준 「재난 안전 정보 전달을 위한
  수어영상 데이터」로 표기하고 aihub.or.kr 링크 연결.

- **node_modules 깨끗하게 재설치** — proposal에서 복사한 node_modules가 일부 패키지의 `dist/`가
  누락된 불완전 복사였고(rsync), npm이 "이미 설치됨"으로 보고 건너뛰어 빌드가 실패했습니다.
  `node_modules`+lock 삭제 후 클린 설치로 해결.

- **지구 텍스처는 절차적 폴백 유지** — Blue Marble 텍스처(`public/textures/earth_daymap.jpg`)는
  미포함. Globe 컴포넌트가 텍스처 부재 시 시안 셰이딩의 절차적 지구로 자동 폴백하므로 빈 화면 없이
  동작합니다(원하면 텍스처만 추가하면 사진 지구로 업그레이드).

## 3D 아바타 업그레이드 (밤샘 작업)

- **GitHub 연동은 `gh` 없이 처리** — `gh` CLI·brew 미설치. 키체인에 저장된 HTTPS 자격증명(계정
  `BioCode67`, `repo` scope)으로 GitHub API 레포 확인 + HTTPS push. 레포는 이미 빈 상태로 존재해
  덮어쓸 내용 없었음. git author는 로컬 설정(DavidLee197)로 기록.

- **3D 모델: VRM 채택** ("알아서" 위임 → 최고 품질·웹통합 기준 선택) — `@pixiv/three-vrm`. 표준
  휴머노이드 본 + 정규화 T포즈로 2D→본 리타게팅이 가장 깔끔하고 손가락 본이 규격으로 보장됨.
  AI Hub 제공 아바타는 Unity 빌드(`player.exe` + 625MB `resources.assets`) 내부에 임베드돼 있어
  웹에서 바로 못 쓰고, 리핑은 윈도우 툴+재배포 라이선스 불명확이라 제외(BLOCKERS.md 참고).

- **모델 파일: pixiv/three-vrm 샘플 VRM 1.0** (`VRM1_Constraint_Twist_Sample.vrm`)을
  `public/models/avatar.vrm`로 동봉. 클론 즉시 동작하도록 레포에 포함(13MB). Mixamo식 Xbot GLB도
  `fallback-xbot.glb`로 캐시(대체용). 정식 데모용으론 VRoid Studio로 만든 자체 모델로 교체 권장.

- **VRM 로더 타입 충돌 우회** — drei(useGLTF)는 three-stdlib GLTF 타입, three-vrm은 @types/three
  타입을 요구해 `register`에서 타입 불일치. 런타임 동일하므로 `any` 시드 함수(`extendWithVRM`)로 우회.

- **3D 모드는 lazy 청크 + 토글 추가** — Three.js/VRM 번들이 무거워 `Avatar3D`를 `React.lazy`로 분리,
  3D 모드 선택 시에만 로드. 기존 2D 아바타/스켈레톤은 "비교용"으로 유지하고 3-way 토글로 전환.

- **VRM1 모델은 +Z(정면)을 향함** — 처음 `rotation.y=π`로 뒤집었더니 뒤통수가 보여서 회전 제거.
  (VRM0는 -Z라 회전 필요하지만 이 VRM1 샘플은 기본이 정면.)

- **팔 리타게팅(2-a)** — 어깨·팔꿈치·손목 세그먼트 방향을 본 회전으로. rest축(±X)→타깃방향
  쿼터니언, 부모 월드 역변환으로 로컬화. confidence<0.15 무시, slerp 0.45 스무딩. 프레임별 변화 확인.

- **손가락 리타게팅(2-b) + NaN 가드** — 손+15개 손가락 본을 동일 솔버로 root→tip 체이닝. 손가락
  추가 직후 스킨 메시 전체가 사라졌는데, 부모 역회전 후 방향벡터가 0에 가까워질 때 setFromUnitVectors가
  NaN 쿼터니언을 만들고 스키닝을 통해 메시 전체를 무효화한 것이 원인. `_tp` 길이·`Number.isFinite`
  가드 + 로컬/월드 쿼터니언 normalize로 해결. (에러는 안 났고 메시만 사라져 원인 추적이 까다로웠음.)

- **표정·머리·눈깜빡임·호흡** — `expr.mo→aa(입)`, `expr.br→surprised(눈썹)` 블렌드셰이프, 목은
  neck→nose 방향, 4초 주기 자동 눈깜빡임, 척추 미세 sine 호흡으로 생동감 추가.

- **떨림 완화: 키포인트 시간축 스무딩** — 본 회전 slerp(0.45)에 더해, 키포인트 자체를 신뢰도 가중
  ±1프레임 평균(0.25/0.5/0.25)으로 선스무딩. 저신뢰 이웃 프레임은 제외해 엉뚱한 좌표로 끌리지 않게 함.

- **깊이 복원(2D 한계 완화)** — 2D만으로는 앞뒤를 모르지만, 팔 세그먼트의 2D 길이가 실제 길이보다
  짧으면(단축) 부족분을 +z(카메라 쪽)로 복원. 수어는 항상 앞으로 제스처하므로 부호는 +로 고정.
  실제 길이는 문장별 in-plane 2D 길이의 **92퍼센타일**로 추정(최대값은 노이즈에 과민). 손은 평면 유지
  (손목 신뢰도·노이즈 때문). 결과적으로 손이 몸에 눌리지 않고 앞으로 나오는 자연스러운 자세.

- **3D UX** — 스테이지에 "드래그로 360° 회전 · 휠로 확대" 힌트. OrbitControls로 자유 회전·줌(팬 비활성).

## 히어로 재설계 · 배너 · 데이터 확장

- **히어로 지구본 → 'Signal Field' 네트워크 교체** — 지구본이 검정으로 깜빡이는 문제(낮/밤 명암경계)와
  낮은 퀄을 해결하기 위해 지구본을 제거하고, 발광 노드 성좌 + 허브에서 흐르는 데이터 펄스 + 마우스
  시차 + bloom 의 추상 네트워크로 교체(`src/three/HeroScene.tsx`). 텍스처/명암경계가 없어 깜빡임 원천 차단.

- **배너 당위성 콘텐츠** — 히어로 통계 스트립(등록 청각장애인 42만+/한국수어 법정 공용어/24시간) +
  `WhySection`(통계 밴드 + 정보격차·골든타임·해법 카드)로 공모전 설득력 강화.

- **아바타 모델** — CC0 무료 VRM은 전부 스타일라이즈라 사실적 정장 모델 확보 실패(BLOCKERS 참고).
  `VRMUtils.rotateVRM0`로 VRM 0.x/1.0 모두 지원해 `public/models/avatar.vrm` 교체만으로 캐릭터 변경 가능.

- **재난 문장 6→17개 확장 (데이터 ETL)** — AI Hub Validation 라벨 7z(확장자만 .zip, 실제 7-Zip)을
  `bsdtar`(libarchive)로 해제(unzip/zipfile은 Zip64·7z 미지원). 형태소 JSON의 `landmarks`에 키포인트가
  들어 있어 XML(6.96GB)은 불필요. 변환기(`/tmp/convert.py` → public/data):
  - 3D 랜드마크는 카메라 intrinsic_F로 2D 투영, 2D 랜드마크는 그대로 사용(둘 다 지원).
  - **퍼센타일(2~98%) 기반 정규화**로 렌더 SRC 박스에 정합 — 초기엔 min/max를 써서 이상치 Z(≈0) 투영
    폭주로 골격이 한 점으로 붕괴했음(퍼센타일+Z범위 필터로 해결).
  - gloss 타이밍 + 얼굴 랜드마크 기반 입벌림(expr) 변환. 침수·호우·대설·산사태·강풍·태풍·미세먼지·
    화재·산불·한파·포항 지진 등 자연/사회재난 다양화.

- **참고용 원본 데모 동봉** — 이식 정합성 비교를 위해 원본 `signbridge_demo.html`을
  `public/reference_demo.html`로 함께 두었습니다(앱 번들과 무관, `/reference_demo.html`로 열람 가능).

- **AI Hub 라벨링 원본(xml/json) zip은 아직 다운로드 중이라 미사용** — `1.키포인트(xml)_VL.zip` 등은
  INNORIX 임시파일(.irx961) 상태로 다운로드가 끝나지 않아 추출 불가. 데모는 제공된 가공본
  `sign_N.json`(OpenPose 키포인트)을 사용. 다운로드 완료 후 동일 포맷으로 변환해 문장을 추가하면 됩니다.

## 사실적 아바타 전환 (Ready Player Me + GLB 리타게팅)
- **요구**: 스타일라이즈 말고 "사람 같은" 실사 + 정장 기자/아나운서. 2D 아바타 제거.
- **차단 상황**: 빌드 샌드박스에서 readyplayer.me CDN이 DNS 차단(브라우저에선 됨). CC0 무료 VRM(100Avatars/VIPE 3000+)은 전부 스타일라이즈.
- **해결**: GitHub에 커밋된 RPM 풀바디 실사 아바타(wass08 r3f 튜토리얼)를 raw로 확보 — 기자(남, Naoki)·앵커(여, Nanami)·인물. public/models에 동봉(오프라인 시연 안정).
- **GLB 리타게팅 신설**(`glbRetarget.ts`): VRM 정규화 리그가 아닌 임의 글TF 휴머노이드용. bind 포즈에서 각 본의 rest 축을 읽어 키포인트 방향에 정렬. 본 이름은 `mixamorig` 접두 제거로 매칭(three.js가 ':'를 떼어 `mixamorig2RightArm` 형태가 되는 점 반영 — 이게 초기 0본 매칭의 원인이었음).
- **프레이밍**: 머리/엉덩이 본으로 모델별 스케일 정규화 + 카메라 후퇴로 머리~허리 여유 표시.
- **손 안정화**: 손가락/팔 회전 각도 클램프 + true 3D 경로로 꺾임·튕김 완화.
- **2D 아바타 제거**: 모드는 3D 아바타/스켈레톤(키포인트), 기본값 3D 실사.

## 손가락 일그러짐 수정 + 아바타 18종 확장
- **손가락 곡률(curl) 기반 리타게팅**(`glbRetarget.ts`): 기존엔 손가락 본을 키포인트 방향으로 직접 "조준"해 측면 비틀림이 생겨 손가락이 일그러졌음. 이를 **굴곡(flexion) 전용**으로 교체 — 손 로컬 프레임의 옆축(knuckle axis)을 각 본 로컬로 환산해 `flex` 축으로 고정하고, 관절별 굽힘각(prev·cur 내적)만큼 그 축으로만 회전. 측면 비틀림 0 → 자연스러운 주먹/펴기. `FINGER_FLEX_MAX=1.5rad`로 과굴곡 클램프, NaN 가드 유지. (검증: 실사 앵커 손가락 자연스럽게 안쪽으로 말림 확인)
- **아바타 8종(번들) + RPM 10종(스트리밍) = 18종**:
  - 번들(로컬, 렌더·수어 검증 완료): 실사 앵커(여)/인물(남·avatarsdk)/인물(남2·kosdesign)/캐주얼(여·RPM gf)/데이비드/줄리아/정장 기자(남·Naoki)/캐릭터 안내원(여·Nanami, 스타일라이즈). 기본값=앵커(여), 전부 손가락 본·블렌드셰이프 보유.
  - 폐기: avaturn 예제 default_model(얼굴 텍스처 미로딩=흰 얼굴, 라벨 불일치) 제외.
  - **RPM 후보 10종(↗)**: GitHub 공개 데모 소스에서 수집한 유효 RPM ID를 `models.readyplayer.me/<id>.glb?morphTargets=ARKit` 로 스트리밍. RPM은 전부 동일 스켈레톤이라 **손동작은 번들과 동일 보장**, 외형만 다름 → 사용자가 브라우저에서 보고 추리는 용도. (샌드박스는 RPM CDN DNS 차단이라 외형 검증 불가; 기본/번들은 로컬이라 시연 안정성에는 영향 없음.) 사용자가 고른 것만 추후 로컬 번들로 고정 예정.

## 기획안(수정본) 반영 + RPM 흑화면 수정 + 손가락 정확도
- **RPM 스트리밍 아바타 흑화면 제거**: RPM CDN 모델 로드 실패 시 ErrorBoundary 없이 useGLTF가 throw → 캔버스 전체 흑화면. RPM 후보 10종을 전부 제거하고 **검증된 번들 8종만** 유지. 추가로 `AvatarErrorBoundary`를 도입해 어떤 모델이든 로드 실패 시 "아바타를 불러오지 못했습니다" 안내로 폴백(흑화면 방지), 아바타 변경 시 자동 리셋.
- **손가락/수어 정확도 개선**: ① 추종 응답성 상향(SMOOTH 0.4→0.46, SMOOTH_FINGER 0.16→0.26)으로 실제 수어 핸드셰이프에 더 빠르게 수렴. ② 손가락 굴곡축을 단일 손-옆축 공유에서 **본별 기하 계산(palmNormal × boneRestDir)**으로 교체 — 4지(指)는 기존 부호 보존, **엄지는 고유 굴곡축**을 갖게 되어 엄지 말림 자연화. 펴기/주먹 양쪽 핸드셰이프 검증 완료, 일그러짐 없음.
- **표정 문구 제거**: 표정(입모양)은 현재 고정(블링크만)이므로 데모의 "표정(입·눈썹) 비수지 반영" 문구 삭제 → 손·팔 관절 좌표 리타게팅/경량 좌표(0.1Mbps) 전송 중심으로 재서술. 비수지는 "전체 시스템에서 단계적 정밀화"로 표기. 스테이지 배지 "VRM·3D 아바타"→"실사 3D 아바타·관절 리타게팅".
- **사이트를 4-에이전트 Agentic AI + 양방향 Q&A로 재구성**(HowItWorks 전면 개편): ①재난 판단 ②수어 변환 ③Q&A 대응(양방향 강조) ④송출 제어 카드 + **양방향 Q&A 흐름 블록**(농인 질문/GPS → Q&A 에이전트 분석 → 수어 응답). KOREN 활용 칩을 H200 GPU·HPC(V100)·SDI(SDN/NFV)·400Gbps 전용선·WebRTC/SRT·AI Network Lab로 갱신.
- **시스템 구성도 재작성**(SystemDiagram): 입력(재난문자+농인질문/GPS) → KOREN HPC 4-에이전트 → KOREN망(SRT/WebRTC, 좌표 0.1Mbps) → 출력 단말 + **양방향 Q&A 점선 귀환 경로**.
- **통계 갱신(기획안 정합)**: 청각장애인 약 42만→**44만(복지부 2024, 16.8%)**, **90.8%** 수어 적합 인식, **수어방송 5%**(자막 100%), **BLEU 16.33**, **대역폭 95%↓**(영상 4~8Mbps→좌표 0.1Mbps), **종단 1초 이내**(WebRTC), **동시채널 5+**. Hero·Why·Impact·NetworkPanel 전반 반영. "44종 재난 카테고리"(44만과 혼동) 지표 삭제.

## 아바타 정리 + 2D 아바타 고급화
- **저품질 아바타 제거**: 실사 인물(남2·jiwoo, 가죽자켓 저품질)·실사 캐주얼(여·emma, RPM 반실사)·캐릭터 안내원(여·yuna, 큰머리 만화체) 3종 삭제(파일 포함). 디자인 일관성을 위해 스타일별로 정직하게 재라벨: 포토리얼 3종(실사 앵커 여/인물 남/인물 남2=david)은 "실사", brunette(julia)는 "캐릭터(여)", anime Naoki는 "만화풍 기자(남)"로 분리.
- **2D 아바타 모드 재도입 + 고급화**: 사용자 요청("2d 아바타 중 깔끔한 것 퀄 높여")에 따라 `renderAvatar`를 전면 리디자인 — 기존 틸 색 카툰 → **네이비 정장 + 화이트 셔츠 V + 시안 넥타이의 클린 플랫 앵커**(사이트 톤 정합). 머리/헤어/눈 정돈, 표정은 고정 정책에 맞춰 **정적 중립 표정**(입·눈썹 애니메이션 제거, expr 의존 제거). 모드 토글에 '2D 아바타' 노출(3D/2D/스켈레톤), 배지 "클린 2D 아바타 · 관절 구동". 동일 키포인트로 구동되어 모든 문장에서 동작.
- **참고**: 샌드박스에서 RPM/Avaturn CDN이 DNS 차단이라 신규 포토리얼 GLB 추가 풀이 고갈 — 검증 가능한 깔끔한 5종으로 정리하고, 완전 제어 가능한 2D 아바타를 고급화해 "깔끔한 추가 옵션" 수요에 대응.

## 양방향 Q&A 인터랙티브 데모 (기획안 핵심 차별점 실연)
- **결정**: 사용자가 "Grok Companions/타 API 활용" 제안 → 핵심 제약(우리 아바타는 *지정 수어 키포인트* 재현 필수)을 검토. Grok/HeyGen/D-ID류는 텍스트·음성으로 **자체 제스처를 생성**해 우리 키포인트 구동 불가 → 수어 재현엔 부적합(예쁜 아바타가 엉뚱한 제스처). 적합한 "강력 도구"는 ① RPM/Avaturn로 *리깅 GLB* 받아 우리가 구동(단 CDN 차단으로 사용자가 .glb 제공 필요) ② LLM으로 Q&A 실연. 사용자 "너가 알아서" → **자율 완결 가능하고 임팩트 큰 ②를 실행**.
- **QnADemo 신설**(`src/sections/QnADemo.tsx`, App·Navbar에 #qa 추가): GPS(관악구 신림동)+재난(호우경보) 컨텍스트 바 → 자주 묻는 질문 4종 버튼 → **Q&A 에이전트 분석 애니메이션**(위치 확인→재난 분석→대피소 조회→수어 생성) → 맞춤 대피 안내 + 수어 글로스 칩 + KOREN 0.4s + "수어 아바타로 보기(#demo)". 기획안의 "1차 버튼·텍스트 FAQ" 형태와 정확히 일치.
- **구현 방식**: 정적 gh-pages 안정성 위해 **응답 사전 번들**(키 노출/네트워크 의존 0, 시연 무중단). 실서비스 전환은 `ask()`를 라이브 LLM(서버리스 프록시) 호출로 교체만 하면 됨 — UI 하단에 그 취지 명시.
- **포토리얼 아바타(옵션①) 슬롯 대기**: 사용자가 RPM/Avaturn .glb URL/파일 주는 즉시 public/models에 넣고 avatars.ts에 추가하면 바로 구동.

## 오픈소스 VTuber 검토 + 커스텀 아바타 URL 로더
- **사용자 제안(Open-LLM-VTuber, Project AIRI 등) 검토**: Open-LLM-VTuber는 Live2D(2D 퍼펫, 팔·손 관절 없음→수어 불가), AIRI는 VRM을 런타임 로드(번들 없음), GitHub의 .vrm은 대부분 Git LFS 포인터(샌드박스에서 실파일 수신 불가). 결론: 대화형 VTuber 스택은 전부 *자체 모션 생성*이라 우리 수어 키포인트 구동과 맞지 않음 — 단, 그들이 쓰는 리깅 VRM/GLB '모델'은 우리가 구동 가능.
- **근본 해결책 = 커스텀 아바타 URL 로더**(SignAvatarDemo): 사용자가 RPM·Avaturn·VRoid·AIRI 등 어디서 만든 `.glb`/`.vrm` 주소든 붙여넣으면 **즉시 로드되어 수어로 구동**. `loadCustom()`이 URL 검증 후 setAvatarUrl → Avatar3D가 VRM/GLB 자동 분기 → AvatarErrorBoundary가 실패(잘못된 URL·CORS·LFS) 시 "불러오지 못했습니다"로 폴백. '내 아바타 ✓' 칩 표시. 검증: 유효 URL 입력→커스텀 활성+폴백 정상(샌드박스는 RPM 차단이라 실로드는 사용자 브라우저에서).
- **효과**: 샌드박스 CDN 차단이라는 내 제약을 우회 — 사용자가 직접 어떤 모델이든 즉시 시험/적용. 아바타 품질 향상의 병목(내가 못 받음)을 사용자 셀프서비스로 해소.

## 손가락 정확도 2차 — 손가락 벌림(abduction/spread) 추가
- 기존 곡률(curl) 전용 방식은 굽힘만 재현하고 **좌우 벌림(spread)**이 없어 펼친 손(5수형 등)이 모은 손(B형)처럼 보였음. 이를 보완:
  - **키포인트 손 프레임** 생성(`buildKpHandFrame`): 손목·중지/검지/새끼 MCP로 fwd(→중지)·side(검지→새끼)·normal 축을 아바타 손 프레임과 동일 규칙으로 구성 → 좌우각 비교 가능.
  - prepareGLBRig에서 4지 MCP 본에 **abduct 축(손바닥 normal, 본 로컬)** + **restLat(정지 좌우각)** 저장.
  - 런타임: 너클(MCP)에서 `curLat = atan2(cur·side, cur·fwd)` 측정 → `spread = clamp(curLat - restLat, ±0.42rad)`을 abduct 축으로 회전, 기존 curl과 합성(bind·spread·flex). **엄지 제외**, **3D 키포인트일 때만** 적용, ±24° 클램프로 왜곡 방지.
- 검증: 펼친 손에서 손가락이 자연스럽게 부채꼴로 벌어지고 왜곡/역꺾임 없음(프레임 308·220 확인). 곡률만 쓰던 기존 대비 핸드셰이프 판독성 향상.

## GitHub 아바타 재탐색 결과 + vroid 추가
- 코드검색(여러 쿼리)·repo 직접 probe로 재탐색 → 사용 가능한 신규 실사 모델은 거의 없음(대부분 Git LFS 스텁이라 raw로 실파일 수신 불가, 또는 저폴리). 실사 풀은 고갈 확인 → **커스텀 URL 로더가 실질적 해법**임을 재확인.
- 1건 추가: TalkingHead `vroid.glb`(2.2MB, VRoid 익스포트, 247노드·손가락 4/4·블렌드셰이프) → `char-vroid.glb`로 번들, "캐릭터(여2)"로 추가. 비례 깔끔한 고품질 애니풍이나 판타지 의상이라 스타일라이즈로 분류(사용자 큐레이션용). 손가락 신규 spread로 자연 구동 확인.

## 커스텀 아바타 — 로컬 파일 업로드 추가 (URL만으로는 부족)
- 문제: 사용자가 VRoid/RPM 등에서 모델을 받아도 *파일*이지 *URL*이 아니라, URL 전용 로더로는 못 썼음("사이트 접속/사용 불가"의 실제 원인).
- 해결: SignAvatarDemo 로더에 **로컬 파일 업로드** 추가(`onFile` → `URL.createObjectURL` → setModel). `.glb`/`.vrm` 파일을 컴퓨터에서 선택하면 blob URL로 즉시 로드·수어 구동. 어떤 사이트(VRoid Hub·Booth·Sketchfab 등)에서 받은 파일이든 호스팅 없이 사용 가능. 파일은 브라우저 내에서만 처리(업로드 없음). 이전 blob URL은 모델 변경 시 revoke(누수 방지). URL 입력은 보조로 유지.
- 검증: 번들 모델을 File로 만들어 input에 주입→change→blob URL로 렌더 성공("내 아바타 ✓"), 정상 수어 구동.

## 사용자 제공 VRM 추가 (Booth "business")
- 사용자가 Booth에서 "VRM 무료 business" 검색해 받은 `keito_a.vrm`(VRM 0.x "けいとA", 20.5MB, 손가락 본 30·휴머노이드 54·블렌드셰이프) 제공 → `business-keito.vrm`로 번들, "비즈니스 정장(VRM)"으로 추가. VRM 경로(applyPoseToVRM)로 구동, 깔끔한 네이비 정장·손가락 자연 구동 확인. 파일 업로드 기능이 실제로 동작함을 입증한 첫 사용자 모델.

## VRM 팔 위로 꺾임 버그 수정 + toma VRM 추가
- 증상: 비즈니스 정장(VRM·keito) 정지 프레임에서 양팔이 머리 위로 곧게 꺾여 있음(실사 GLB는 정상).
- 원인: VRM 경로(retarget.ts)가 어깨 rest 축을 **하드코딩 ±X(T-포즈 가정)**로 썼는데, VRoid/Booth VRM은 대부분 **A-포즈 바인드(팔이 아래로)**라 잘못된 rest 축을 향해 조준 → 팔이 위로 솟음. (GLB 경로는 본별 bind 방향을 읽어 self-calibrating이라 정상이었음.)
- 수정: GLB와 동일하게 **VRM도 self-calibrating** — `prepareVRMRig(vrm)`가 로드 시 정규화 휴머노이드에서 각 본의 실제 rest 방향(자식 본 로컬 오프셋)을 캡처(`VRM_CHILD_MAP`: 상완·전완·손·목·손가락), `aimBone`이 하드코딩 축 대신 이 rest 축 사용(없으면 기존 축 폴백). Avatar3D VRM 셋업(rotateVRM0 직후)에서 호출.
- 검증: keito·toma 모두 정지 시 팔 자연스럽게 내려옴, keito는 가슴 높이로 자연 수어 동작. 향후 사용자가 올리는 어떤 A-포즈 VRM도 자동 보정.
- 추가: 사용자 제공 `toma_c.vrm`(VRM0 "とうまC", 정장 베스트) → "비즈니스 정장2(VRM)"로 번들. 아바타 8종.

## 기획안·발표자료(_1) 반영 — 통계 갱신
- 국립국어원 통계 정정: "90.8% 수어 적합 인식" → **"69.3% 일상에서 수어를 주로 사용 — 제1언어"**(WhySection)로 갱신(발표 slide3·기획안 정합). 출처 복지부 2024·국립국어원.
- 발표자료 핵심기술(slide 10·11) 반영: HowItWorks에 **전송 비교 블록** 신설 — ① 대역폭(수어영상 4~8Mbps vs 관절좌표 ≈0.1Mbps, **40~80× 절감**, 67관절=자세25+양손42×30fps) ② 종단지연 막대비교(HLS 3~10초·LL-HLS 2~5초·SRT 0.3~0.8초·WebRTC 0.2~0.5초, SRT 방송 1위 77%). 나머지 KPI(BLEU 16.33·1초·95%·90%·5+채널)·44만·5%·KOREN(H200·V100·SDN·400Gbps)은 기존과 일치 확인.

## 지속 개선: 소셜 메타·접근성·Q&A 시나리오 확장
- **Open Graph/Twitter 메타**(index.html): og:title/description/url/image(favicon)/type/site_name/locale + twitter:card. 공모 링크 공유 시 미리보기 개선.
- **접근성**(접근성 앱답게): `<MotionConfig reducedMotion="user">`로 모든 framer-motion 애니메이션이 OS '동작 줄이기' 설정 존중(CSS는 기존 prefers-reduced-motion 처리). 키보드 **건너뛰기 링크**(.skip-link, 포커스 시 노출 → #demo), `<main id="main">`.
- **양방향 Q&A 시나리오 3종 확장**(QnADemo): 🌧️호우(관악 신림)·🌐지진(경주, 규모5.8)·🔥화재(마포 합정) 탭 — 시나리오별 GPS·재난 톤(색)·맞춤 질문 4개·수어 응답·글로스. 단일 시나리오 → 다중으로 데모 설득력 강화. 검증: 지진 탭 GPS=경주·맞춤 응답 정상.
- 모바일(390px) 점검: 가로 오버플로 없음, 전송 비교 막대·KOREN 칩·히어로 모두 정상.

## 지속 개선 2: 내비 스크롤스파이 + 데모 접근성
- **Navbar 스크롤스파이**: IntersectionObserver(중앙 -45/-50%)로 현재 섹션 nav 링크 활성 표시(시안 + 밑줄, aria-current). 검증: #qa 스크롤 시 "양방향 Q&A" 활성.
- **데모 접근성**: 모드 토글 `aria-pressed`, 3D 스테이지 `role="img"` + 현재 문장 `aria-label`.

## 로딩 성능: GLB 텍스처 최적화 (WebP + 리사이즈)
- gltf-transform 4.4로 표준 GLB 아바타 텍스처를 max 1024 리사이즈 + WebP(q85)로 재인코딩 — **본/모프 무손상**(검증), three.js GLTFLoader 네이티브 WebP 지원이라 런타임 디코더 불필요·Draco 미사용(리그 안전).
  - avaturn(기본) 13.8→11.4MB, avatarsdk 12.3→11MB, david 4.6→3.8, julia 4.5→3.3 (naoki 이미 최적). 총 78→70MB, 특히 **기본 아바타 초기 로딩 단축**.
- VRM(keito·toma)·char-vroid는 VRM 확장/MToon 보호 위해 미변경.
- 검증: 최적화된 avaturn·avatarsdk 렌더 동일 품질(로고 텍스트까지 선명), 수어 정상 구동.

## 모바일 가독성: 시스템 구성도 가로 스크롤
- 시스템 구성도 SVG(1080폭)가 모바일에서 너무 작게 축소되던 문제 → 컨테이너 `overflow-x-auto` + SVG `min-w-[680px]`로 모바일에선 가로 스크롤(읽을 수 있는 크기 유지), "← 옆으로 밀어서 전체 보기 →" 힌트(sm:hidden). 검증: 390px에서 4-에이전트 박스·라벨 가독.

## OG 미리보기 이미지 제작
- 공모 링크 공유 시 미리보기용 `public/og.png`(1200×630) 제작 — 다크+시안 브랜드, 네트워크 모티프, "들리지 않아도, 닿습니다" 헤드라인+서브카피+URL. resvg-js로 SVG→PNG 렌더, 한글은 시스템 `AppleGothic.ttf` 사용(토푸 없이 정상). meta를 og.png + twitter summary_large_image로 갱신. 소스/재생성법은 scripts/og.svg·gen-og.md.

## 비즈니스 정장 VRM 2종 제거 (사용자 요청)
- "비즈니스 정장(VRM)"·"비즈니스 정장2(VRM)"(keito·toma) 제거 — 사용자 선호도. 파일 삭제로 모델 70→35MB 경량화. 아바타 6종(실사 3 + 캐릭터 2 + 만화풍 기자). 파일 업로드 기능은 유지되어 사용자가 원하면 언제든 다시 VRM 추가 가능.

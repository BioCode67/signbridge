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

- **참고용 원본 데모 동봉** — 이식 정합성 비교를 위해 원본 `signbridge_demo.html`을
  `public/reference_demo.html`로 함께 두었습니다(앱 번들과 무관, `/reference_demo.html`로 열람 가능).

- **AI Hub 라벨링 원본(xml/json) zip은 아직 다운로드 중이라 미사용** — `1.키포인트(xml)_VL.zip` 등은
  INNORIX 임시파일(.irx961) 상태로 다운로드가 끝나지 않아 추출 불가. 데모는 제공된 가공본
  `sign_N.json`(OpenPose 키포인트)을 사용. 다운로드 완료 후 동일 포맷으로 변환해 문장을 추가하면 됩니다.

# SignBridge — 재난 안전 정보 AI 수어 아바타

재난 안전 정보(재난문자·속보)를 **한국수어(KSL) 아바타**로 변환해 보여 주는 웹 애플리케이션입니다.
AI Hub「재난 안전 정보 전달을 위한 수어영상 데이터」의 **실제 OpenPose 키포인트**를 Canvas로 렌더링하며,
3D 지구·KOREN 네트워크 히어로와 작동 원리 다이어그램으로 서비스 비전을 함께 전달합니다.

> **들리지 않아도, 닿습니다.**

---

## 기술 스택

- **Vite + React 19 + TypeScript**
- **Tailwind CSS** (다크 우주톤 + 시안 포인트 디자인 시스템)
- **Three.js** — `@react-three/fiber`, `drei`, `postprocessing` (히어로 3D 지구/네트워크/블룸)
- **framer-motion** — 스크롤 기반 등장 애니메이션
- **Canvas 2D** — 수어 아바타/스켈레톤 재생 (검증된 데모 로직 이식)

## 실행 방법

```bash
npm install      # 최초 1회
npm run dev      # 개발 서버 (http://localhost:5173)
npm run build    # 타입체크 + 프로덕션 빌드 → dist/
npm run preview  # 빌드 결과 미리보기
```

## 화면 구성

1. **히어로** — 자전하는 3D 지구 + KOREN 네트워크 노드/펄스(시안 글로우), 큰 타이포.
2. **수어 아바타 데모 `#demo`** (핵심) — 실제 키포인트 기반 아바타 재생. 문장 탭 · 아바타↔스켈레톤 토글 ·
   타임라인 스크럽 · 0.5/1/1.5배속 · 글로스 하이라이트 · 한국어 원문.
3. **작동 원리 `#how`** — 방송 입력 → KOREN 저지연망 → HPC 수어 변환 → 전국 동시 송출 파이프라인.
4. **푸터** — 서비스명, 데이터 출처(AI Hub) 표기.

---

## 📂 문장 데이터 추가하는 법 (코드 수정 불필요)

데모는 `public/data/manifest.json`을 읽어 **탭을 자동 생성**합니다. 새 문장을 추가하려면:

1. 새 데이터 파일을 `public/data/`에 넣습니다. 예: `public/data/sign_7.json`
2. `public/data/manifest.json` 배열에 파일명만 추가합니다.

```jsonc
// public/data/manifest.json
[
  "sign_1.json",
  "sign_2.json",
  "sign_3.json",
  "sign_4.json",
  "sign_5.json",
  "sign_6.json",
  "sign_7.json"   // ← 추가하면 탭이 자동으로 늘어납니다
]
```

저장하면 새 탭이 자동으로 생깁니다. (지진·태풍·호우 등 추가 데이터를 이렇게 부으면 됩니다.)

### 데이터 포맷 (`sign_N.json`)

```jsonc
{
  "korean_text": "금일 대설, 한파로 도로결빙 우려되니 ...",  // 한국어 원문(재난문자)
  "fps": 30,
  "num_frames": 686,
  "gloss_sequence": [                                      // 수어 단어 + 타이밍(초)
    { "gloss": "오늘1", "start": 1.401, "end": 2.244 }
  ],
  "keypoints": {                                           // OpenPose, 프레임별 평면 배열
    "pose":       [[x, y, conf, ... 25관절 × 3 = 75개], ...],
    "hand_left":  [[x, y, conf, ... 21관절 × 3 = 63개], ...],
    "hand_right": [[x, y, conf, ... 21관절 × 3 = 63개], ...]
  },
  "expr": [{ "mo": 13.9, "br": 17.3 }, ...]                // 프레임별 표정(입벌림/눈썹높이)
}
```

- 좌표는 소스 픽셀 단위(약 650–1350 x, 200–1100 y). 렌더러가 캔버스에 맞게 자동 매핑합니다.
- `expr`은 선택값(없으면 기본 표정). 손목 confidence가 0인 경우가 많아 손가락 좌표 기준으로 손을 그립니다.

---

## 프로젝트 구조

```
signbridge-app/
├─ public/
│  ├─ data/
│  │  ├─ manifest.json          # 문장 파일 목록 (동적 탭 소스)
│  │  └─ sign_1~6.json          # 재난 문장 + 키포인트 데이터
│  └─ reference_demo.html       # 이식 원본 데모 (참고용, 앱과 무관)
├─ src/
│  ├─ sections/
│  │  ├─ Hero.tsx               # 3D 히어로 + 카피
│  │  ├─ SignAvatarDemo.tsx     # ★ 수어 아바타 데모 (핵심 화면)
│  │  ├─ HowItWorks.tsx         # 작동 원리 파이프라인
│  │  ├─ Footer.tsx
│  │  └─ sign/
│  │     ├─ renderSign.ts       # Canvas 아바타/스켈레톤 렌더러 (데모 로직 이식)
│  │     ├─ useSignData.ts      # manifest 기반 동적 데이터 로더
│  │     └─ signTypes.ts
│  ├─ three/                    # Globe / NetworkArcs / NetworkNodes / Starfield
│  ├─ navigation/Navbar.tsx
│  ├─ ui/                       # Button / SectionHeading
│  ├─ hooks/useResponsive.ts    # 브레이크포인트 + reduced-motion → 3D 품질 스케일
│  └─ data/networkNodes.ts      # KOREN 네트워크 노드 좌표
└─ DECISIONS.md                 # 자율 작업 중 내린 판단 기록
```

## 선택 사항 — 사진 지구 텍스처

히어로 지구는 텍스처가 없으면 **시안 셰이딩의 절차적 지구**로 자동 폴백합니다(빈 화면 없음).
실사 Blue Marble로 바꾸려면 `public/textures/earth_daymap.jpg` 경로에 텍스처를 넣으면 됩니다.

---

## 데이터 출처

본 데모의 키포인트·문장 데이터는 **AI Hub**「재난 안전 정보 전달을 위한 수어영상 데이터」를 가공한 것입니다.
원천 데이터의 저작권 및 이용 조건은 AI Hub 정책을 따릅니다. (https://www.aihub.or.kr)

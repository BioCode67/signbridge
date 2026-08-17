# SignBridge — 재난 안전 정보 양방향 AI 수어 번역

재난 안전 정보를 **한국수어(KSL)로, 수어를 한국어로** 번역하는 양방향 시스템입니다.
AI Hub 실데이터 36만 클립(재난안전 16만 + 수어영상 24만)으로 학습한 모델들이
브라우저 안에서 직접 동작합니다.

> **들리지 않아도, 닿습니다.**

## 지금 되는 것 (전부 실측·실구동 검증)

| 자리 | 기능 | 수치 |
|---|---|---|
| **창구 대화** | 직원이 마이크로 말하면 → 자막 + 수어 아바타 | 임의 문장 · 창구 대화 낱말 표현률 **85.7%**(홀드아웃 81.0%) |
| | 농인이 카드·필담·**수어로** 답하면 → **소리로** 출력 | 기기 내장 음성합성(서버·요금·회선 불필요) |
| | 장소별 상용구 | 병원·약국·주민센터·택시·긴급·은행·식당·경찰서·우체국·마트 **10곳 59문구** |
| **재난 정보** | 재난문자 → 3D 아바타 수어 | 실제 재난문자 246건 낱말 표현률 **95.8%** · 행동요령 91.6% |
| | 재난별 행동요령을 문장 단위로 수어 | 행정안전부 국민행동요령 11종 |
| **수어 인식** | 웹캠 실시간 단어 인식 | 어휘 8,147종 · top-1 **78.7%**(수어자 분리) · 추론 18ms |
| | 학습에 없던 수어자 13명 | top-1 **78.6%** · top-5 **91.9%** — 수어자가 바뀌어도 유지 |
| | 인식 낱말을 **후보에서 골라 고치기** | top-5 90.8%를 손가락 한 번으로 |
| | 글로스 → 한국어 문장 | "머리 어제 아프다" → "머리 어제 아파요" |
| **오프라인** | 회선이 끊겨도 창구 대화가 된다 | 필수 10MB 자동 · 전체 41MB 선택(인식 모델 포함) · **차단 상태 재생 실측** |

- **수어 이용자 전용 화면** `#/app` — 텍스트 최소·시각 벨·큰 자막. 받기 / 대화 / 질문 / 사전.
- **폰·태블릿(가로/세로)·키오스크** 네 화면에서 자동 검증(`scripts/e2e_app.py`).
- **키오스크 배치**: 주소에 `#/app?kiosk=1` — 대화 화면으로 시작, 큰 글씨, 닫기 숨김.
  5분 손대지 않으면 대화가 스스로 지워져 앞사람 내용이 다음 사람에게 남지 않는다.
- **응급 대비** — 혈액형·지병·약·알레르기·보호자 연락처를 SOS 화면에 크게(기기에만 저장),
  현재 위치 좌표, 주변에 보여주는 SOS 문구.
- **정직성 원칙** — 모든 수치는 측정값만. 표현하지 못하는 낱말은 감추지 않고 큰 낱말 카드로
  띄운다. 음성 합성이 실패하면 "전달했어요" 대신 실패했다고 붉게 알린다 —
  소리를 못 듣는 사용자에게 **거짓 확인**이 가장 위험하다.

> 🧪 학습 파이프라인(KOREN AI Cloud GPU): **[ml/README.md](ml/README.md)** ·
> 판단 기록: **[DECISIONS.md](DECISIONS.md)** · 배포: **[deploy/HF_SPACES.md](deploy/HF_SPACES.md)**

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

1. **히어로** — 'Signal Field' 발광 네트워크(노드+데이터 펄스, 마우스 시차·bloom) + 회전 태그라인 + 핵심 통계 스트립.
2. **왜 필요한가 `#why`** — 청각장애 통계(약 42만·한국수어 법정 공용어) + 정보격차·골든타임·해법 카드.
3. **수어 아바타 데모 `#demo`** (핵심) — 실제 키포인트 기반 아바타 재생, 재난 17종. 문장 탭 ·
   **아바타(2D) / 스켈레톤 / 3D 3-way 토글** · 타임라인 · 0.5/1/1.5배속 · 글로스 하이라이트 · 한국어 원문.
4. **작동 원리 `#how`** — 재난입력 → KOREN 저지연망 → HPC·GPU AI 변환 → 수어 아바타 → 전국 다채널 송출.
   KOREN 활용 칩 + **시스템 구성도(SVG)** 포함.
5. **기대효과·상용화 `#impact`** — 공익적 가치·상용화(B2G)·확장성 + 지표.
6. **푸터** — 서비스명, 데이터 출처(AI Hub), 넷 챌린지 캠프 컨텍스트.

---

## 🧍 3D 아바타 작동 방식

기존 2D Canvas 아바타/스켈레톤은 **비교용**으로 유지하고, **3D 모드**를 추가했습니다(토글 전환).

- **모델**: [VRM](https://vrm.dev) 1.0 (`@pixiv/three-vrm`). 표준 휴머노이드 본 + 정규화 T포즈라
  손가락까지 리타게팅이 깔끔합니다. 동봉 모델은 pixiv/three-vrm 샘플(`public/models/avatar.vrm`).
  정식 데모용으론 [VRoid Studio](https://vroid.com/studio)로 만든 자체 모델로 교체 권장(같은 경로에 덮어쓰기).
- **리타게팅(`src/sections/sign/retarget.ts`)**: AI Hub 키포인트는 **2D**(OpenPose 이미지 좌표)뿐이라,
  아바타가 카메라를 정면으로 본다고 가정하고 각 관절 세그먼트 방향을 본 회전으로 변환합니다.
  - 본의 rest 방향(±X)을 세그먼트 방향(`Qp⁻¹·t`)에 정렬하는 쿼터니언을 root→tip으로 체이닝
  - **상반신**(어깨–팔꿈치–손목) + **양손 15개 손가락 본** + **목 기울기**
  - **표정**: `expr.mo`→입벌림(`aa`), `expr.br`→눈썹(`surprised`) 블렌드셰이프
  - `confidence < 0.15` 관절은 무시, 프레임 간 **slerp 스무딩**으로 떨림 억제
- **한계(솔직히)**: 2D 데이터라 **깊이(앞뒤) 정보가 없어** 정면 평면 동작만 재현됩니다.
  `pose_keypoints_3d`가 있는 데이터로 바꾸면 3D 회전까지 정확해집니다. 손가락은 키포인트 노이즈에
  민감합니다.
- **성능**: 3D 청크(`Avatar3D`)는 3D 모드 선택 시에만 lazy 로드, `dpr`은 최대 2로 제한.

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
│  │  ├─ bank.json              # 동작 사전 색인 10,175종 (낱말 → 조각 파일)
│  │  ├─ glosses/               # 낱말별 실연 동작 조각 (약 215MB)
│  │  ├─ align.json             # 한국어 낱말 → 글로스 사전 12만 항목(활용형 포함)
│  │  ├─ order.json             # 수어 어순 편향표(말뭉치에서 잰 낱말 위치)
│  │  ├─ offline.json           # 오프라인 준비 목록(필수/전체) — 빌드 때 생성
│  │  ├─ feed.json              # 실제 재난문자 246건
│  │  ├─ manifest.json          # 문장 파일 목록 (동적 탭 소스)
│  │  └─ sign_1~17.json         # 재난 문장 17종 (2D/3D 키포인트 + 표정)
│  ├─ models/
│  │  ├─ avatar.vrm             # 3D 아바타 모델 (VRM, 교체 가능)
│  │  └─ fallback-xbot.glb      # Mixamo식 GLB 대체 모델(캐시)
│  ├─ textures/                 # earth_daymap/earth_lights (구 지구본 자산)
│  └─ reference_demo.html       # 이식 원본 데모 (참고용, 앱과 무관)
├─ src/
│  ├─ user/                     # ★ 수어 이용자 전용 앱 (#/app)
│  │  ├─ UserApp.tsx            #   받기 / 대화 / 질문 / 사전 네 탭
│  │  ├─ TalkMode.tsx           #   창구 대화 — 마이크·음성출력·수어입력·응급정보
│  │  ├─ SignInputPanel.tsx     #   수어로 답하기(카메라 → 후보 고르기 → 소리)
│  │  ├─ MyInfoPanel.tsx        #   내 정보(혈액형·지병·약·보호자) — 기기에만 저장
│  │  ├─ SignStage.tsx          #   아바타 무대(자막·진행바·낱말 카드)
│  │  ├─ useSignPlayer.ts       #   번역 → 합성 → 프레임 루프
│  │  ├─ useOfflineReady.ts     #   오프라인 준비(필수 자동 / 전체 선택)
│  │  ├─ places.ts              #   창구 10곳 상용구 59개
│  │  ├─ safetyGuides.ts        #   재난별 행동요령 11종
│  │  └─ talkHistory.ts         #   지난 대화 보관(누를 때만 저장)
│  ├─ sections/
│  │  ├─ Hero.tsx               # 히어로(회전 태그라인·통계) + HeroScene
│  │  ├─ WhySection.tsx         # 왜 필요한가 (통계·문제·해법)
│  │  ├─ SignAvatarDemo.tsx     # ★ 수어 아바타 데모 (핵심, 2D/스켈레톤/3D 토글)
│  │  ├─ HowItWorks.tsx         # 작동 원리(KOREN 파이프라인 + 칩)
│  │  ├─ SystemDiagram.tsx      # 시스템 구성도(SVG)
│  │  ├─ ImpactSection.tsx      # 기대효과·상용화
│  │  ├─ Footer.tsx
│  │  └─ sign/
│  │     ├─ renderSign.ts       # Canvas 2D 아바타/스켈레톤 렌더러
│  │     ├─ Avatar3D.tsx        # ★ R3F VRM 3D 아바타 (스튜디오 라이팅·그림자)
│  │     ├─ retarget.ts         # ★ 키포인트→VRM 본 회전 (3D 직접/2D 폴백) + 표정
│  │     ├─ useSignData.ts      # manifest 기반 동적 데이터 로더
│  │     └─ signTypes.ts
│  ├─ three/
│  │  ├─ HeroScene.tsx          # ★ 히어로 'Signal Field' 네트워크
│  │  └─ Globe/NetworkArcs/...  # (구 지구본 컴포넌트, 미사용)
│  ├─ navigation/Navbar.tsx
│  ├─ ui/                       # Button / SectionHeading
│  ├─ hooks/useResponsive.ts    # 브레이크포인트 + reduced-motion
│  └─ data/networkNodes.ts
├─ DECISIONS.md                 # 자율 작업 중 내린 판단 기록
└─ BLOCKERS.md                  # 막혔거나 보류한 항목
```

## 선택 사항 — 사진 지구 텍스처

히어로 지구는 텍스처가 없으면 **시안 셰이딩의 절차적 지구**로 자동 폴백합니다(빈 화면 없음).
실사 Blue Marble로 바꾸려면 `public/textures/earth_daymap.jpg` 경로에 텍스처를 넣으면 됩니다.

---

## 데이터 출처

본 데모의 키포인트·문장 데이터는 **AI Hub**「재난 안전 정보 전달을 위한 수어영상 데이터」를 가공한 것입니다.
원천 데이터의 저작권 및 이용 조건은 AI Hub 정책을 따릅니다. (https://www.aihub.or.kr)

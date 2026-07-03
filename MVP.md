# SignBridge — 실시간 재난 수어통역 MVP 현황

NETCC 시즌13용 **재난방송 실시간 수어통역 시스템 MVP**의 구현 현황·검증·실행법·한계·로드맵 정리.
"논문급 완벽함"이 아니라 **실제로 돌아가는 데모 + 확장 로드맵**을 목표로 한다.

> 기존 저장소는 재난 텍스트 → 사전녹화 키포인트 → 3D 수어 아바타 **재생(출력)** 데모였다.
> 이번 MVP는 그 반대 방향인 **웹캠 → 수어 동작 인식 → 자막(입력)** 파이프라인과, 이를 감싸는
> **4-에이전트 구조 + 양방향 Q&A(KoGPT2)**를 실제 동작 코드로 추가한 것이다.

---

## 1. 전체 아키텍처

```
[웹캠]
  │  getUserMedia (브라우저 내에서만 처리, 영상 미전송)
  ▼
[MediaPipe Holistic]  ── 포즈33 + 왼손21 + 오른손21 랜드마크 (Step1)
  │  frameToFeatures(): 어깨중점 원점·어깨너비 스케일 정규화 → 155차원
  ▼
[특징 링버퍼] ── 최근 프레임 누적 → SEQ_LEN(32) 리샘플
  ▼
[GRU 분류기]  ── 30개 재난 키워드 softmax (Step2, TF.js)
  │  신뢰도·안정성(연속 2회) → 자막 토큰 확정
  ▼
[실시간 자막 UI]  (Step4, #live)

── 4-에이전트 파이프라인 (Step3, #agents) ──────────────────────
[입력: 재난문자 또는 인식 토큰 + 농인 질문]
  → (a) DisasterAgent  재난 종류·심각도 판단
  → (b) SignAgent      텍스트 → KSL 글로스
  → (c) QAAgent        질문 → 언어백본 응답 → 글로스   ← KoGPT2/Template (Step5)
  → (d) BroadcastAgent 채널·우선순위·KOREN POP 라우팅(시뮬)
```

| 레이어 | 위치 | 기술 |
|--------|------|------|
| 랜드마크 추출 | `src/recognition/holistic.ts`, `useHolistic.ts` | MediaPipe Tasks Vision |
| 특징·시퀀스 | `src/recognition/landmarks.ts` | 155차원, SEQ_LEN 32 |
| 분류 모델 | `src/recognition/model.ts`, `scripts/train-synth.mjs` | TF.js GRU |
| 실시간 인식/자막/스튜디오 | `src/recognition/useRecognizer.ts`, `src/sections/RecognitionDemo.tsx` | — |
| 4-에이전트 | `src/agents/*` | 규칙 + 교체형 백엔드 |
| Q&A 언어백본 | `server/app.py`, `src/agents/kogpt2Backbone.ts` | KoGPT2 (FastAPI) |

---

## 2. 완료 항목 & 검증

| Step | 내용 | 검증 결과 |
|------|------|-----------|
| **1. 랜드마크 추출** | 웹캠→Holistic→포즈·양손 실시간 추출, 오버레이, `#live` | 빌드·타입체크 통과. 지연로드 청크 분리. *웹캠 실동작은 카메라 있는 브라우저 필요.* |
| **2. GRU 분류기** | 랜드마크 시퀀스 → 재난키워드 30종. 합성 데이터 학습 스크립트 | 학습 `val_acc 1.000`, 신규샘플 **30/30(100%)**. 브라우저 로드경로(`loadLayersModel`) **30/30** 헤드리스 검증. |
| **3. 4-에이전트** | 판단·변환·Q&A·송출 인터페이스+구현+오케스트레이터, 콘솔 `#agents` | 타입체크·빌드 통과, 브라우저 내 실동작. |
| **4. 실시간 자막** | 링버퍼 추론(250ms)·자막 확정(debounce), **자체수집 학습 스튜디오** | 빌드 통과. 녹화→브라우저 GRU 학습→즉시 인식 경로 구현. |
| **5. KoGPT2 Q&A** | FastAPI `/qa`·`/health`, 브라우저 백본+폴백, 콘솔 토글 | 모델 로드 23s·생성 2s, `/qa` **HTTP 200 UTF-8 한국어** 응답 확인. |

**핵심 정직성 메모**: 배포된 기본 GRU 모델은 **합성 데이터** 학습본이라 파이프라인 실증용이며
실제 수어를 인식하지 않는다. 실제 인식은 두 경로로 얻는다 — ① `#live`의 **자체수집 학습 스튜디오**
(내 손동작 녹화→학습), ② 추후 **AI Hub 실데이터** 학습. KoGPT2-base는 instruction 튜닝이 안 돼
응답이 거칠므로 데모 기본 백본은 안정적인 **템플릿**으로 두었다.

---

## 3. 데모 실행법

### 3-1. 프런트엔드 (필수)
```bash
npm install        # 최초 1회
npm run dev        # http://localhost:5173
```
- `#live` **실시간 인식**: [카메라 시작] → 손·상반신 오버레이 + 인식 자막.
  - 실제 인식을 보려면 **🎓 자체수집 학습 스튜디오** 열기 → 단어 선택 → ●녹화(1.5s)를
    단어당 2회 이상, 2개 이상 단어 → [학습 시작](수 초) → 배지가 "내 모델 ✓"로 바뀌면
    그 단어들을 실시간 인식.
- `#agents` **4-에이전트 콘솔**: 프리셋(호우/지진/화재) 또는 직접 입력 → [파이프라인 실행].

### 3-2. GRU 기본 모델 재학습 (선택)
```bash
node scripts/train-synth.mjs   # public/models/ksl-gru/ 재생성
```

### 3-3. KoGPT2 Q&A 서버 (선택, Step5)
```bash
# torch 사전설치 가정 (CPU: pip install torch --index-url https://download.pytorch.org/whl/cpu)
pip install -r server/requirements.txt
uvicorn server.app:app --port 8000
```
- 이후 `#agents` 콘솔에서 **"Q&A 백본으로 KoGPT2 사용"** 체크 → 서버 연결 시 KoGPT2 생성,
  실패 시 자동으로 템플릿 폴백(결과 카드의 `백본` 표시로 확인).

### 브라우저 권장
Chrome(웹캠 + WebGL/GPU 가속). MediaPipe WASM·모델은 CDN에서 로드(오프라인 시연 시 로컬 동봉 필요).

---

## 4. 남은 리스크 · 한계

- **웹캠 실동작 미검증(헤드리스)**: 카메라·GPU가 있는 실기기에서 FPS·추적 안정성 확인 필요.
- **기본 GRU = 합성 학습**: 실제 수어 인식은 자체수집 학습 또는 AI Hub 학습으로만 성립.
- **키워드 단위 인식 MVP**: 문장단위 수어 번역은 연구 영역 → 목표 아님(로드맵).
- **2D 랜드마크 한계**: 깊이(앞뒤) 정보 부족 → 정면 동작 위주. (기존 아바타 재생도 동일 한계.)
- **KoGPT2-base 미튜닝**: 응답이 산만할 수 있음 → 템플릿 폴백 유지, 튜닝은 로드맵.
- **MediaPipe CDN 의존**: 오프라인 시연 시 WASM/`.task` 로컬 번들링 필요(`holistic.ts` 경로 교체).
- **번들 크기**: 인식 청크 ~1MB(gzip 270KB, TF.js 포함) — 지연로드로 초기 페인트는 보호됨.

## 5. 확장 로드맵

1. **AI Hub 실데이터 학습** — 「재난 수어영상」키포인트를 155차원 특징으로 변환하는 ETL →
   동일 GRU 아키텍처로 학습(모델 파일만 교체). 토폴로지 매핑(OpenPose↔MediaPipe) 필요.
2. **인식 정확도** — 시퀀스 어텐션/Transformer, 데이터 증강, 사용자 보정.
3. **문장단위** — 키워드열 → 문장 복원(언어모델), 비수지(표정) 반영.
4. **KoGPT2 파인튜닝/instruction 튜닝** 또는 상위 LLM 백본(같은 인터페이스로 교체).
5. **실서비스 송출** — BroadcastAgent를 KOREN SDN/NFV 제어면과 연동(실 멀티캐스트).
6. **오프라인 패키징** — MediaPipe·모델 로컬 번들, PWA/Capacitor 앱.

---

*Author: BioCode67 · 데이터 출처: AI Hub「재난 안전 정보 전달을 위한 수어영상 데이터」.*

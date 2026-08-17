# SignBridge — 프로젝트 안내 (Claude Code 자동 로드)

한국수어(KSL) 양방향 번역 시스템. 재난 상황에서 농인에게 정보를 전달하는 것이 목표다.

```
텍스트 → 글로스 → 3D 아바타   (출력)  … 동작함. 글로스 변환이 아직 규칙 기반
웹캠 → 랜드마크 → 자막         (입력)  … 동작함. 다만 모델이 합성 데이터 학습본
```

지금 하는 일은 **가운데의 진짜 모델을 AI Hub 실데이터로 학습시키는 것**이다.

---

## 절대 깨뜨리면 안 되는 것

### 학습 특징 == 추론 특징

`ml/signbridge/features.py`(파이썬 학습)와 `src/recognition/landmarks.ts`(브라우저 추론)는
**같은 155차원 특징을 만들어야 한다.** 한쪽만 고치면 "검증 정확도 95%인데 웹캠에선 0%"가 된다.
이 프로젝트에서 가장 찾기 어려운 실패다.

```bash
python -m ml.tools.feature_parity     # 둘 중 하나라도 건드리면 반드시 실행
```

Node 22의 타입 스트리핑으로 TS를 직접 실행해 수치를 대조한다. 현재 **오차 0**.

### 앱 글로스 == 동작 사전

`src/user/places.ts`의 상용구 글로스와 `dictSignAgent.ts`의 숫자·단위 글로스는
동작 사전(`public/data/bank.json`)에 **실존해야 한다.** 없으면 재생 때 조용히
건너뛰어 **아바타가 가만히 서 있는데 한국어 원문은 그대로 떠 있다** — 화면만 봐서는
정상으로 보인다. 실측에서 사전 재생성 뒤 상용구 30개 중 17개가, '월'이 31회,
'점'이 8회 이렇게 증발했다.

```bash
bash ml/jobs/rebuild_data.sh            # 동작 사전 → 번역 사전 → 어순표 → 검사 2종
python3 ml/tools/check_app_glosses.py   # (위 스크립트에 포함) 개별 실행도 가능
```

**순서가 중요하다.** 번역 사전·어순표는 동작 사전을 보고 만들어진다. 동작 사전만 다시
만들고 나머지를 두면 사라진 글로스를 가리키는 번역이 남아 아바타가 조용히 서 있는다.

학습이 끝나면 모델도 갈아 끼운다 — 실측에서 60에폭을 돌리는 동안 앱에는 **에폭 27짜리**가
붙어 있었다(화면상 차이가 없어 아무도 몰랐다).

```bash
bash ml/jobs/deploy_model.sh ~/sbruns/iso-v2
```

### 화면이 아니라 수치로 검증

이 앱의 실패는 대부분 "화면은 정상인데 알맹이가 없는" 모양이다. 눈으로는 못 잡는다.

```bash
npm run build && python3 scripts/e2e_app.py    # 폰·태블릿·키오스크 실조작
node --experimental-strip-types --import ./scripts/ts-register.mjs \
     scripts/check_translation_cases.mjs        # 번역 오역 회귀 검사
```

### 커버리지는 정확도가 아니다

낱말 표현률은 "몇 %가 수어로 나갔나"만 잰다. **맞게 나갔는지는 재지 않는다.**
실제로 복합어 프루닝 버그로 "어디가 아프신지"가 "어디 아프다 **신다(신발)**"로
번역되던 동안에도 표현률은 그대로였다. 잘못된 수어는 표현되지 않은 것보다 나쁘다 —
농인은 그것을 믿기 때문이다. `scripts/translation_cases.json`에 실측에서 한 번이라도
틀렸던 사례를 박아 두었다(must / never). **사전·활용형 규칙을 건드리면 반드시 실행.**

도메인별 실측(2026-08-17): 재난문자 95.8% · 행동요령 91.6% · 창구 대화 85.7% ·
**창구 홀드아웃 81.0%**(튜닝에 쓰지 않은 문장 — 일반화를 재는 정직한 숫자).
측정용 문장은 `scripts/audit_sets/`에 있다. **홀드아웃을 보고 사전을 고치기 시작하면
그 순간 홀드아웃이 아니다** — 고칠 때는 튜닝 집합만 보고, 홀드아웃은 결과 확인에만 쓴다.

재생 프레임 수·소리로 나간 문장·요소 크기를 수치로 확인한다(`data-sign-*` 계측점).
**dev 서버(5173)로 검증하지 말 것** — Vite dev는 실행 중 새로 생긴
`public/data/glosses/` 파일을 index.html로 폴백해(200 text/html) 모든 합성이 실패한다.
배포본에서는 정상이다. 이 차이로 한동안 회귀를 오인했다.

### 평가는 수어자 분리로

같은 사람이 학습·평가에 함께 있으면 모델이 그 사람 버릇을 외워 정확도가 부풀려진다.
`ml/etl/prepare.py --split-by signer`가 기본값인 이유다. 발표용 숫자는 반드시 이 기준.

---

## 구조

```
src/                 React + three.js 프런트엔드 (아바타·웹캠 인식 데모)
  recognition/       브라우저 추론 — landmarks.ts가 특징 정의의 한쪽
server/app.py        KoGPT2 Q&A FastAPI (선택)
ml/                  ★ 학습 파이프라인 (지금 작업 중인 곳)
  signbridge/        features · models · dataset · openpose · naming · pack
  etl/               aihub_disaster · aihub_sl · prepare · merge_index · extract_mediapipe
  tools/             feature_parity(필수 검증) · check_app_glosses(앱↔사전 정합) · schema_report
  data/daily_vocab.txt  창구 생활 어휘 — 빈도로 잘리면 안 되는 낱말 목록
scripts/e2e_app.py     폰·태블릿·키오스크 3종 실조작 검증
scripts/audit_translation.mjs  번역 품질 실측(도메인별 표현률·빠진 낱말)
scripts/check_translation_cases.mjs  오역 회귀 검사(사례 34건)
scripts/demo_rehearsal.py  시연 대본 조작을 그대로 눌러 보는 리허설
  jobs/              check_workspace · train_* · pbs_extract
                     rebuild_data.sh(웹 데이터 전부 재생성) · deploy_model.sh(모델 교체)
  README.md          전략·데이터셋·실행 절차     ← 먼저 읽을 것
  KOREN_SETUP.md     이 워크스페이스 운영
  KOREN_RESOURCES.md AI Cloud / HPC / KOREN VM 역할 분담
DECISIONS.md         판단 기록 (맨 아래가 최신)
```

모델은 3단으로 쪼개져 있다. 한 번에 문장 번역을 노리지 않는다.

| 단계 | 스크립트 | 내용 |
|---|---|---|
| ① 단어 인식 | `ml/train_isolated.py` | 랜드마크 → 글로스. **여기부터** |
| ② 연속 인식 | `ml/train_ctc.py` | 랜드마크열 → 글로스열 (CTC) |
| ③ 언어 복원 | `ml/train_gloss2text.py` | 글로스 ↔ 한국어 (KoBART) |

③의 `--direction text2gloss`는 키포인트 없이 라벨 텍스트만으로 학습 가능하고,
현재 앱의 규칙 기반 `signAgent.ts`를 바로 대체한다.

---

## 실행 환경 (KOREN AI Cloud)

- GPU `h200-mig-1g.35gb` — FP32 17.14 TFLOPS(H200 전체의 약 29%). **메모리는 넉넉, 연산은 부족.**
  그래서 영상 CNN이 아니라 랜드마크 트랜스포머(2.8M 파라미터)를 쓴다.
- 가상환경 `torch2.5.1-py3.12-cuda12.4`. **torch를 재설치하지 말 것**(CUDA 어긋남).
  학습·ONNX 내보내기를 torch 2.5.1과 2.13 양쪽에서 검증해 두었다.
- **홈(`/home/jovyan`)은 워크스페이스를 지우면 함께 사라진다.** 코드·데이터·체크포인트는
  반드시 사용자 볼륨에 둘 것. 볼륨 미등록 경로는 재시작만으로도 날아간다.
- `bash ml/jobs/check_workspace.sh` — GPU·볼륨·AI Hub 접속·라이브러리를 한 번에 점검.

---

## 실데이터에서 확인된 함정 (문서에 없던 것들)

원본을 직접 열어 보고 잡은 것들이다. 다시 밟지 말 것.

| 함정 | 실제 |
|---|---|
| **재난안전: 메타가 `metadata` 안에 중첩** | `signer`·`augment`·`video_fps`·`filmed_in_studio`가 최상위가 아니다. 최상위에서만 찾으면 signer가 비고 → 수어자 분리가 조용히 무력화된다 |
| 글로스 필드 이름 | 재난안전 `sign_script.*[].gloss_id` / 수어영상 `data[].attributes[].name` |
| 글로스가 세 층렬 | `sign_gestures_both` / `_strong`(우세손) / `_weak`(비우세손). 합쳐 시간순 정렬 필요 |
| 3D 배열 stride가 다름 | 재난안전 3D = 점당 3값(x,y,z) / 수어영상 3D = 점당 **4값**(x,y,z,conf) |
| `people`이 리스트가 아님 | 수어영상 키포인트는 `"people": {…}` 딕셔너리. 리스트만 가정하면 좌표가 전부 0 |
| 파일명 표기 불일치 | 가이드는 `WRD`, 실데이터는 `WORD` |
| **`.zip`인데 실제로는 7z** | AI Hub 배포본은 확장자만 zip이고 내용은 7-Zip(LZMA2)이다. `unzip`도 파이썬 `zipfile`도 못 연다("End-of-central-directory signature not found"). **확장자를 믿지 말고 매직 바이트로 판별**할 것 |
| **7z가 통짜(Solid) 압축** | `Solid = +`, `Blocks = 1`. 멤버 하나만 꺼내려 해도 앞에서부터 다 풀어야 해서, 파일마다 따로 열면 O(n²)가 되어 끝나지 않는다. **처음부터 끝까지 한 번만 훑으며** 처리해야 한다(`stream_7z`) |
| 내려받는 중 용량이 3배로 | aihubshell이 `download.tar` → 분할 조각 → 병합 순으로 처리한다. 90G 파일 하나에 순간 최대 ~270G |
| 좌표 단위가 제각각 | mm·미터·픽셀이 섞인다. **절대 임계값을 쓰지 말고** 중앙값 상대 기준으로 판정 |
| 깊이 추정 실패 프레임 | `-25,000,000` 같은 값이 섞여 있다. `openpose.sanitize_3d` 필수 |
| 어깨 검출 붕괴 | 정규화 좌표가 20배를 넘으면 그 클립은 쓰레기. `pack.feature_health`가 잡아낸다 |

원본을 새로 받으면 **먼저 구조부터 확인**한다:

```bash
python3 ml/tools/schema_report.py <경로 또는 zip> --limit 3
```

---

## 현재 상태 / 다음 할 일  (2026-08-17 밤 기준)

**끝난 것 — 전부 실측**

| 항목 | 수치 |
|---|---|
| 고립 단어 인식 iso-v1 (60에폭) | 검증 top-1 **0.7868** · top-5 0.908 (수어자 분리) |
| 처음 보는 수어자 13명(49,721표본) | top-1 **0.7863** · top-5 **0.9188** — 검증치와 같다 |
| 번역 낱말 표현률 | 재난문자 **95.8%** · 행동요령 **91.6%** · 창구 대화 **85.7%**(홀드아웃 **81.0%**) |
| 웹 동작 사전 | 11,448종(일상어 클립 2,963종 포함) |
| 번역 사전 | 155,185낱말(활용형·조사형 포함, gzip 643KB) |
| 앱 | 폰·태블릿(가로/세로)·키오스크·오프라인 자동 검증 통과 |

키오스크는 `#/app?kiosk=1`로 세운다(대화 화면 시작·큰 글씨·닫기 숨김·5분 자동 초기화).

앱은 **창구 대화**까지 완성됐다 — 직원 마이크 → 자막+수어, 농인의 답(카드·필담·수어)
→ **음성 출력**, 응급 정보·위치, 지난 대화 보관, 오프라인 준비.

**돌고 있는 것**
- `iso-v2` — 재난+일상 합본(클래스 13,576 · 표본 217만). 40에폭, 에폭당 약 24분
  (2026-08-18 오전 완료 예정). 끝나면 `bash ml/jobs/deploy_model.sh ~/sbruns/iso-v2`
- 그다음 자동으로 **CTC**(연속 문장 인식)가 이어진다 (`~/sbruns/queue_chain2.sh`)
- 진행은 `~/sbruns/queue.log` · `~/sbruns/iso-v2.log`

**다음 할 일**
1. iso-v2 완료 → 모델 교체 → `npm run build && python3 scripts/e2e_app.py`
   → 인식 어휘가 8,147 → 13,576으로 늘어 창구 낱말(가슴·열·기침·얼마·화장실)이 붙는다
2. CTC 학습 결과 확인 — 낱말 단위에서 **문장 단위**로 넘어가는 단계
3. 당사자 평가(농아인협회·복지관 방문, 9월) — 아바타 이해도와 창구 흐름을 직접 듣는다
4. KOREN VM 상시 데모 서버(`~/deploy/koren-vm/설치.sh`), HPC 분산 전처리 잡

**남은 한계 (데이터가 없어서 못 하는 것)**
- **지문자(고유명사)** — 공개 데이터에 자모 세트가 9개뿐이라 이름·지명을 손으로 못 쓴다.
  낱말 카드로 정보 손실만 막아 두었다.
- **비수지(표정)** — 조각에 표정 데이터가 없다. 규칙으로 지어내지 않기로 했다.
- 창구 낱말 중 처방전·번호표·등본·부작용 등은 **수어 클립 자체가 없다**.

---

## 작업 규칙

- 커밋 author는 **BioCode67 &lt;6wngud@gmail.com&gt;**, **AI 서명·Co-Authored-By를 넣지 않는다**
  (사용자 지시, `DECISIONS.md`에 기록됨)
- 작업 브랜치: `claude/sign-language-translation-system-a0mzqi`
- 판단이 필요한 결정을 내렸으면 `DECISIONS.md` 맨 아래에 근거와 함께 남긴다
- 주석과 문서는 한국어로 쓴다
- 정확도·성능을 말할 때는 **측정한 것만** 말한다. 추정치를 수치처럼 적지 않는다

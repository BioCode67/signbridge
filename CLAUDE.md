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
python3 ml/tools/check_app_glosses.py   # 동작 사전을 다시 만들면 반드시 실행
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

도메인별 실측(2026-08-17): 재난문자 95.5% · 행동요령 88.6% · 창구 대화 84.5%

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
scripts/check_translation_cases.mjs  오역 회귀 검사(사례 25건)
  jobs/              check_workspace · train_* · pbs_extract
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

## 현재 상태 / 다음 할 일

**끝난 것**
- 파이프라인 전 구간 실행 검증(ETL → 분할 → 학습 → CTC → ONNX 내보내기)
- 재난안전·수어영상 어댑터를 **실제 샘플 구조로** 검증
- TS ↔ 파이썬 특징 일치 오차 0
- 환경 점검 통과: GPU 인식, `cuda.is_available()=True`, **AI Hub 접속 HTTP 200**

**아직 없는 것**
- **정확도 수치.** 실데이터가 아직 없어서 어떤 숫자도 의미가 없다.
- 브라우저 ONNX 연동은 실제 학습 모델이 나온 뒤에 붙인다

**막고 있는 것 — 두 가지뿐**
1. **홈 볼륨 900GiB로 확대** (현재 50G). 콘솔에서 사람이 해야 한다.
2. **AI Hub API 키** (마이페이지 발급 + 데이터셋 이용 신청 승인)

**다음 순서** — 위 둘이 되면 명령 한 줄씩이다

```bash
export AIHUB_APIKEY=<키>
bash ml/jobs/run_disaster.sh pilot    # 검증셋 11GB로 한 바퀴 (내려받기→구조확인→팩→분할)
cat ~/sbdata/ksl/stats.json           # 어휘 수·표본 수 확인  ← 첫 분기점
bash ml/jobs/run_disaster.sh full     # 학습셋 90GB
python -m ml.train_isolated --data ~/sbdata/ksl --out ~/sbruns/iso-v1 --epochs 60
```

- 받을 것은 **형태소 JSON뿐**. 원천 영상(2TB+)도, 별도 키포인트 XML(52GB)도 받지 않는다
  — 키포인트가 형태소 JSON 안에 이미 있다.
- **zip은 풀지 않는다.** `aihub_disaster`가 zip을 연 채로 멤버만 읽는다. 풀면 수백 GB로
  불어난다. 푼 것과 결과가 같은지는 검증했다(index 동일, 배열 오차 0).
- 경로는 `ml/jobs/koren_paths.sh` 한 곳에 모여 있다. 별도 볼륨을 붙이면 세 줄만 바꾼다.

---

## 작업 규칙

- 커밋 author는 **BioCode67 &lt;6wngud@gmail.com&gt;**, **AI 서명·Co-Authored-By를 넣지 않는다**
  (사용자 지시, `DECISIONS.md`에 기록됨)
- 작업 브랜치: `claude/sign-language-translation-system-a0mzqi`
- 판단이 필요한 결정을 내렸으면 `DECISIONS.md` 맨 아래에 근거와 함께 남긴다
- 주석과 문서는 한국어로 쓴다
- 정확도·성능을 말할 때는 **측정한 것만** 말한다. 추정치를 수치처럼 적지 않는다

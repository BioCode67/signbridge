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
python -m ml.tools.feature_parity        # 둘 중 하나라도 건드리면 반드시 실행
python3 ml/tools/check_rule_parity.py   # 조사·어미·제외어 규칙도 양쪽이 같아야 한다
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
node --experimental-strip-types --import ./scripts/ts-register.mjs \
     scripts/check_site_numbers.mjs     # 화면에 적힌 숫자가 원본과 같은가
node scripts/check_filenames.mjs        # 윈도우에서 압축이 풀리는 이름인가
node --experimental-strip-types --import ./scripts/ts-register.mjs \
     scripts/check_empty_gloss.mjs      # 글로스가 통째로 비는 문장이 없는가
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
node --experimental-strip-types --import ./scripts/ts-register.mjs \
     scripts/check_guide_domain.mjs             # 행동요령이 사전으로 가는가(모델로 가면 헛소리)
node --experimental-strip-types --import ./scripts/ts-register.mjs \
     scripts/check_intent_words.mjs             # 의도 낱말이 인식 클래스에 실존하는가
node --experimental-strip-types --import ./scripts/ts-register.mjs \
     scripts/check_categories.mjs               # 재난 갈래에 한국어 이름이 있는가
python -m ml.tools.ctc_parity                   # CTC 디코딩 파이썬==브라우저
```

### 부정을 잃지 마라

`안`·`못`은 한 글자라 "너무 짧다"는 규칙에 걸려 통째로 버려지고 있었다
(2026-08-18 발견). 빠지면 **뜻이 그대로 뒤집힌다.**

    안 아파요 → 아프다        약을 안 먹었어요 → 약 먹다        못 갑니다 → 가다

병원·약국 창구에서 농인이 "약을 안 먹었어요"라고 답하면 직원은 "약 먹다"로 듣는다.
**표현률로는 절대 안 잡힌다** — 낱말은 다 나갔기 때문이다. 지금은 `안→아니다0`,
`못→못하다1`로 못박혀 있고 회귀 사례에 들어 있다. 한 글자 낱말을 다룰 때
(`ONE_CHAR_NOUNS`) 이 자리를 다시 부수지 말 것.

### 커버리지는 정확도가 아니다

오역을 **찾는** 도구가 따로 있다. 표현률은 오역을 성공으로 세기 때문이다.

```bash
python3 ml/tools/suspect_align.py --top 60   # 글자를 안 겹치는 고빈도 대응 = 검토 대상
```


도구는 **비율**(그 낱말이 나온 문장 중 이 글로스가 같이 나온 비율)과 **지명 표시**를
함께 낸다. 가장 흔한 오역 부류가 지명 오염이다 — 재난문자에는 지역명이 늘 붙어 있어
`모든 → 은행1`, `세부 → 강동2`, `자택 → 권선`처럼 아무 낱말에나 달라붙는다.
**비율이 낮다고 틀린 것은 아니다**(배경 글로스를 Dice가 이미 걸러 낸 결과일 수 있다).
숫자가 골라 주지 않고, 숫자가 좁혀 준 뒤 사람이 고른다. 시드는 활용형까지 퍼진다.

낱말 표현률은 "몇 %가 수어로 나갔나"만 잰다. **맞게 나갔는지는 재지 않는다.**
실제로 복합어 프루닝 버그로 "어디가 아프신지"가 "어디 아프다 **신다(신발)**"로
번역되던 동안에도 표현률은 그대로였다. 잘못된 수어는 표현되지 않은 것보다 나쁘다 —
농인은 그것을 믿기 때문이다. `scripts/translation_cases.json`에 실측에서 한 번이라도
틀렸던 사례 82건을 박아 두었다(must / never). **사전·활용형 규칙을 건드리면 반드시 실행.**

도메인별 실측(2026-08-18): 재난문자 95.8% · 행동요령 **100%** · 창구 대화 92.3% ·
**창구 홀드아웃 89.7%**(튜닝에 쓰지 않은 문장 — 일반화를 재는 정직한 숫자) ·
일상회화 96.9% · 길찾기 100%.
측정용 문장은 `scripts/audit_sets/`에 있다. **홀드아웃을 보고 사전을 고치기 시작하면
그 순간 홀드아웃이 아니다** — 고칠 때는 튜닝 집합만 보고, 홀드아웃은 결과 확인에만 쓴다.

재생 프레임 수·소리로 나간 문장·요소 크기를 수치로 확인한다(`data-sign-*` 계측점).
**dev 서버(5173)로 검증하지 말 것** — Vite dev는 실행 중 새로 생긴
`public/data/glosses/` 파일을 index.html로 폴백해(200 text/html) 모든 합성이 실패한다.
배포본에서는 정상이다. 이 차이로 한동안 회귀를 오인했다.

### 길찾기 답은 방향을 틀리면 안 된다

`묻기` 화면은 "대피소 어디?"에 **방향과 거리**로 답한다. 이 계산이 틀려도 화면은
멀쩡하다 — 화살표도 그려지고 숫자도 뜬다. 다만 엉뚱한 쪽을 가리킨다. 눈으로는 못 잡는다.

실측에서 `북동쪽`이 통째로 **`km 지진 크기`** 로 번역되고 있었다(세 글자 방위어가
복합어 프루닝 기준 4글자에 걸리지 않아 통계 잡음이 1순위로 남았다).

```bash
node --experimental-strip-types --import ./scripts/ts-register.mjs      scripts/check_nearby.mjs      # 거리·방위·어림수·답변 문장
node --experimental-strip-types --import ./scripts/ts-register.mjs      scripts/check_intent.mjs      # 낱말 묶음 → 의도(오검출 포함)
```

주변 장소 목록(`public/data/nearby.json`)은 지금 OpenStreetMap 기반이라
**공식 지정 대피소가 아니다.** 파일이 `official: false`를 들고 있고 화면이 그대로
"참고용"이라고 쓴다. 공식 목록으로 바꾸려면:

```bash
python3 ml/tools/build_nearby.py --gov-key <공공데이터포털 키>   # official: true
bash ml/tools/fetch_osm.sh > /tmp/osm.json                      # 키 없이(참고용)
python3 ml/tools/build_nearby.py --osm /tmp/osm.json
```

### 평가는 수어자 분리로

같은 사람이 학습·평가에 함께 있으면 모델이 그 사람 버릇을 외워 정확도가 부풀려진다.
`ml/etl/prepare.py --split-by signer`가 기본값인 이유다. 발표용 숫자는 반드시 이 기준.

---

## 구조

```
src/                 React + three.js 프런트엔드 (아바타·웹캠 인식 데모)
  recognition/       브라우저 추론 — landmarks.ts가 특징 정의의 한쪽
  user/              당사자 화면 — 받기 · 묻기(AskMode) · 대화(TalkMode) · 사전
    askIntent.ts     수어 낱말 묶음 → 의도(후보까지 보고 판정)
    nearby.ts        주변 장소 · 거리 · 방위 · 답변 문장
    DirectionMap.tsx 타일 없는 방향 지도(오프라인)
server/app.py        KoGPT2 Q&A FastAPI (선택)
ml/                  ★ 학습 파이프라인 (지금 작업 중인 곳)
  signbridge/        features · models · dataset · openpose · naming · pack
  etl/               aihub_disaster · aihub_sl · prepare · merge_index · extract_mediapipe
  tools/             feature_parity(필수 검증) · check_app_glosses(앱↔사전 정합) · schema_report
                     suspect_align(고빈도 오역 후보 검토) · build_nearby(주변 장소 데이터)
                     fetch_place_names.sh(행정구역 지명 — 지명 오염 차단, 키 불필요)
                     fetch_osm_kr.sh(전국 장소) · fix_gloss_filenames(윈도우 안전 이름)
  data/daily_vocab.txt  창구 생활 어휘 — 빈도로 잘리면 안 되는 낱말 목록
scripts/e2e_app.py     폰·태블릿·키오스크 3종 실조작 검증
scripts/shots.py       화면 사진만 찍는다 — "동작하는가"가 아니라 "보기 좋은가"를 사람이 볼 때
scripts/audit_translation.mjs  번역 품질 실측(도메인별 표현률·빠진 낱말)
scripts/check_translation_cases.mjs  오역 회귀 검사(사례 40건)
scripts/check_intent.mjs   수어 낱말 묶음 → 의도 판정 검사(오검출 포함 27건)
scripts/check_nearby.mjs   길찾기 계산 — 거리·방위·어림수·답변 문장·너무 먼 곳 차단
scripts/check_landing.py   소개 페이지 — 섹션 10개·Q&A·에이전트가 실제로 채워지는가
scripts/check_filenames.mjs 윈도우에서 압축이 풀리는 이름인가
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

## 손 데이터에 깊이가 있다 — 버리지 말 것 (2026-08-20)

손가락이 뒤틀린다는 신고를 파고들어 알아낸 것이다.

`public/data/glosses/*.json`의 `keypoints`는 **손 z가 없다** — 세 번째 값이 전부
정확히 1.0인 자리표시자다. 그런데 **원본(`~/sbdata/glossbank`)에는 있다**
(`keypoints3d`). `export_web_bank.py`가 "2D와 섞이면 팔이 튄다"는 이유로 3D를
통째로 버리고 있었다. **팔 때문에 손까지 버린 것이다.**

지금은 **손의 z만** `hand_z`로 싣는다(수록률 96%). 팔은 2D 그대로라 원래 우려한
문제가 생길 여지가 없다. 재보고 정했다 — 뼈 길이 변동계수 **0.182 → 0.142(22% 개선)**,
z 배율은 1.0이 최적(x·y와 같은 단위다).

**두 곳을 함께 봐야 한다.** 조각에만 싣고 `composeLocal.ts`가 안 옮기면 사전 탭
에서만 살고 **받기·묻기의 문장에는 깊이가 하나도 안 남는다**(실제로 그 상태였다).
계측점 `data-sign-handz`로 확인한다 — 1이어야 한다.

    손가락 굽힘은 **손가락당 하나**로 잰다(마디별로 재지 않는다).
    뿌리→끝 직선거리 ÷ 마디 합 = 줄자 비율. 투영에 강해서 깊이가 없어도 살아남는다.
    그 하나를 해부학 비율로 마디에 나눈다 — 사람 손 자세만 나온다.

**손모양 정의는 `src/sections/sign/handShape.ts` 한 곳에만 있다.** 재생
(`glbRetarget.ts`)과 검사가 같은 함수를 쓴다. 두 벌로 두면 features.py ↔
landmarks.ts와 같은 부류의 실패가 된다.

```bash
node --experimental-strip-types --import ./scripts/ts-register.mjs \
     scripts/check_handshape.mjs    # 원본 대비 유지 · 손가락 따로 움직임 · 낱말끼리 갈림
```

**손가락 벌림은 `hand_z`가 있어야 켜진다.** 예전에는 `keypoints3d`가 조건이었는데
웹 조각에 그 키가 없어 **한 번도 켜진 적이 없었다**(2026-08-20). 계측점
`data-sign-spread`가 0이 아니어야 한다 — e2e가 잰다.

**아바타를 바꾸려면 리깅부터 본다.** `real-avaturn`은 손가락 3마디(뼈 30개),
`real-david`·`real-avatarsdk`는 4마디(40개)다. `glbRetarget.ts`는 3마디 기준이라
4마디 리그에서는 손이 주걱처럼 뭉개진다. 얼굴로 고르면 안 된다.

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
| 파일명 표기 불일치 | 가이드는 `WRD`·`FINSP`, 실데이터는 `WORD`·**`FS`**. 갈래 필터가 못 받으면 **0건인데 오류도 안 난다** — 지문자 17,000클립을 이래서 놓쳤다 |
| 라벨에 개행·공백 | `'마천로\n'`·`'대방동길 '`. 안 떼면 같은 지명이 두 종류로 갈린다(1,022 → 1,015) |
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

## 현재 상태 / 다음 할 일  (2026-08-19 기준)

**끝난 것 — 전부 실측**

| 항목 | 수치 |
|---|---|
| 고립 단어 인식 **iso-v2**(배포본) | 검증 top-1 **0.7818** · 클래스 **13,576** (수어자 분리) |
| 〃 이전 iso-v1 | top-1 0.7868 · 클래스 8,147 — 수치는 높지만 문제가 1.7배 쉬웠다 |
| 처음 보는 수어자 13명(49,721표본) | top-1 **0.7863** · top-5 **0.9188** — 검증치와 같다 |
| 번역 낱말 표현률 | 재난문자 **96.1%** · 행동요령 **100%** · 창구 **92.3%**(홀드아웃 **94.8%**) · 일상회화 **96.9%**(홀드아웃 **88.6%**) · 길찾기 **100%** |
| 한국어→글로스 **학습 모델 t2gs-v2**(배포본, 재난문자 한정) | 글로스 F1 **61.3** · BLEU-4 **27.1** · 어순 상관 60.5 |
| 〃 이전 t2gs-v1 | F1 55.5 · BLEU 21.9 — **같은 검증 800문장**으로 다시 재서 견줬다 |
| 〃 배포한 int8 30MB | F1 **62.6** · BLEU **27.3** (검증 400문장, 1스레드 문장당 144ms) |
| 의도 판정 낱말이 인식 클래스에 실존 | **47/47** (`scripts/check_intent_words.mjs`) |
| 재난 갈래 한국어 이름 | **41/41** (`scripts/check_categories.mjs`) — 행동요령은 21/41에만 있다 |
| CTC 디코딩 파이썬↔브라우저 일치 | **3,000판 전부** (`python -m ml.tools.ctc_parity`) |
| 오역 회귀 사례 | **156건** (`scripts/translation_cases.json`) |
| 번역이 낸 글로스가 재생되는가 | 371문장 **2,388개 전부** (`scripts/check_silent_skip.mjs`) |
| 수어 의도 판정 | **27/27** (오검출 0, `scripts/intent_cases.json`) |
| 웹 동작 사전 | **12,833종** · 손 깊이(z) 수록률 96% |
| 번역 사전 | **230,240낱말**(활용형·조사형 포함) |
| 낱말 표현률 재측정(2026-08-20) | 일상회화·행동요령·길찾기 **100%** · 일상 홀드아웃 97.7% · 창구 홀드아웃 97.4% · 창구 96.4% · 재난문자 **96.5%** |
| 오역 회귀 사례 | **156건** (부정·한 글자 낱말·지명 오염 포함) |
| 주변 장소 | **28,125곳 전국**(대피소 14,134) · 15km 넘으면 '없어요'로 답함 |
| 앱 | 폰·태블릿(가로/세로)·키오스크·오프라인 자동 검증 통과 |

키오스크는 `#/app?kiosk=1`로 세운다(대화 화면 시작·큰 글씨·닫기 숨김·5분 자동 초기화).

앱은 **창구 대화**까지 완성됐다 — 직원 마이크 → 자막+수어, 농인의 답(카드·필담·수어)
→ **음성 출력**, 응급 정보·위치, 지난 대화 보관, 오프라인 준비.

그리고 **묻기**(`📹 묻기` 탭) — 카메라 앞에서 수어 → 의도 파악 → 내 위치로 답 생성
→ 아바타가 수어로 답 + 방향 지도. 지금까지 농인은 이 앱에서 정보를 받기만 했다.
지도 타일을 쓰지 않아 **비행기 모드에서도 답한다**(재난 때가 곧 오프라인이다).
인식 부품(MediaPipe 32MB · ONNX 20MB)도 동봉했다 — 예전에는 CDN에서 받아 와서
**회선이 끊기면 카메라가 아예 켜지지 않았다**(오프라인이라고 적어 두고 반쪽이었다).
주변 장소 목록은 아직 OSM 기반이라 **공식 지정 대피소가 아니고**, 화면이 그렇게 밝힌다.

**학습 큐가 비었다 — 2026-08-19에 셋 다 끝났다**

- ~~`t2gs-v2`~~ **배포함.** 같은 검증 800문장으로 견줘 v2가 나았다
  (BLEU 21.9→27.1 · F1 55.5→61.3). 배포한 int8도 따로 재서 무너지지 않았음을 확인.
- ~~`ctc-v1`~~ **끝났지만 앱에 잇지 않았다.** 검증 WER **0.2176**(에폭 59).
- ~~`g2ts-v1`~~ **끝났지만 배포하지 않는다.** 재난 검증 400문장 음절 BLEU **69.7** ·
  음절 F1 **84.0**.

두 모델을 왜 안 붙였는지가 중요하다. **둘 다 재보고 내린 결정이다**(DECISIONS.md).

**ctc-v1 — 클래스 집합이 달라서.** CTC는 8,147종, 배포된 iso-v2는 13,576종이다.
의도 판정 낱말 47개 중 CTC에 있는 것은 **39개뿐**이고, 하필 `화장실`·`소변`이
**둘 다 없다.** 그대로 바꾸면 **화장실 의도가 통째로 죽는다** — 오류도 경고도 없이
"못 알아들었어요"만 나온다. 두 모델을 함께 돌리면 풀리지만(추론 2배·20MB 추가),
그게 실제로 나은지는 **농인이 이어서 수어한 표본을 받아야** 안다. 9월 당사자
평가에서 받아 정한다. 준비물은 다 있다 — `ctcRecognizer.ts` · `deploy_ctc.sh` ·
`ml.tools.ctc_parity`.

**g2ts-v1 — 쓸 자리가 없어서.** 재난문자에서는 사람 번역과 글자까지 같은 문장도
나온다. 그런데 이 모델이 필요한 곳은 창구에서 농인의 답을 **소리로 내보내는**
자리뿐이고, 거기 오는 글로스는 전부 일상어다. 넣어 보니:

    머리 아프다        → 오늘 아침 기온이 크게 오르고 있습니다.
    화장실 어디        → 오늘 아침 기온이 크게 오르고 있습니다.
    예약 하다 원하다    → 이번 비는 눈이 내렸다 그치고 파고 있습니다.

t2gs는 domain으로 갈라 재난문자에만 쓸 수 있었지만, 글로스→한국어는 갈라 봐야
쓸 자리가 안 남는다. t2gs가 틀리면 농인이 이상한 수어를 보고 갸웃하지만,
**g2ts가 틀리면 직원이 "머리 아프다"를 "오늘 아침 기온이…"로 듣고 농인은 자기
말이 어떻게 전달됐는지 볼 수 없다.** 그래서 규칙 기반 `glossToKorean.ts`를 둔다 —
뻣뻣하지만 틀리지 않는다. 일상 병렬 데이터(수어영상 SEN 문장)를 구하면 다시 배운다.

재는 법: `python -m ml.eval_t2g --checkpoint ~/sbruns/g2ts-v1 --data ~/sbdata/script
--direction gloss2text --limit 400` (2026-08-19에 `--direction`을 넣었다)

**번역기 세 단계** (`useSignPlayer` → `NnSignAgent` → `DictSignAgent` → `RuleSignAgent`)

**학습 모델은 재난문자 본문에서만 쓴다.** 같은 "재난"이라도 **행동요령은 사전으로**
보낸다 — 모델은 공지 말투로 배웠고 행동요령은 명령 말투다. 한동안 모델로 보내는
바람에 "엘리베이터를 타지 말고 계단으로 대피하세요"가 `주말1 기간1 필요1 때1 사람2#`로
나갔다(2026-08-18 실측). 목숨이 걸린 안내다. 재난안전 말뭉치로만 배워서 그 밖에서는
**자신 있게 틀린다**(실측: "화장실이 어디예요" → 꽃 꽃 지도 지시# 물 준비 가능 높다).
`compose(text, gloss, domain)`의 domain이 `disaster`일 때만 모델을 쓰고, 기본값은
`everyday`(사전)다 — 모르는 자리에서는 덜 틀리는 쪽을 쓴다.

**다음 할 일**
1. **당사자 평가에서 "이어서 한 수어" 표본을 받아** ctc-v1을 붙일지 정하기.
   붙인다면 iso-v2와 **함께** 돌려야 한다(단독 교체는 화장실 의도를 죽인다).
2. **지문자 학습** — 키포인트만 받으면 된다(`bash ml/jobs/run_fingerspell.sh`).
   `AIHUB_APIKEY`가 필요하다. 자모 CTC가 되면 배우지 않은 이름·지명도 읽는다
3. **당사자 평가**(농아인협회·복지관, 9월) — 지금 우리는 자연스러움도 전달률도
   **하나도 재고 있지 않다.** 표현률·BLEU는 "낱말이 나갔나/맞나"까지만 잰다.
   물어볼 목록은 `DECISIONS.md`에 모아 두었다 — 고개 동작 후보(통계는 강한데
   사람 확인이 없는 것 14종), 손이 잘려 보이는지, 어순이 자연스러운지.
4. ~~고정 주소로 옮기기~~ — **끝났다** (2026-08-19). https://biocode67.github.io/signbridge/
   (GitHub Pages, gh-pages 브랜치). 재배포는 `npm run build && bash deploy/deploy_pages.sh`.
   학습 모델 3종(onnx)도 이제 저장소에 커밋되어 있다 — 어디서 clone해도 빌드된다
5. 공공데이터포털 키로 **공식 대피소 목록** 교체 → 화면의 "참고용" 경고가 사라진다.
   같은 키로 **행정구역 이름표**도 받을 수 있다 — 지명이 낱말 자리를 차지하는
   오역(`상세 → 양천0`)을 도구가 더 잘 잡아낸다
6. 감사 6차 이후 — `python3 ml/tools/suspect_align.py --top 600` 을 이어서 보면
   된다. 400~600위 구간까지 훑었고 누적 55건을 고쳤다. 그 아래는 빈도 60 미만이라
   한 번 틀려도 덜 아프지만, 창구 낱말은 빈도가 낮아도 자주 쓰인다

**사람이 해야 하는 것** (계정·현장이 필요해 자동화할 수 없다)
- Cloudflare Pages 계정 + `dist/` 올리기
- 공공데이터포털 인증키 발급
- **`export AIHUB_APIKEY=<AI Hub 마이페이지 → API 키>`** — 이 워크스페이스의 키가
  비어 있다(작은 파일로 시험해 502 인증실패 확인). 이것만 있으면 지문자 키포인트
  12GB를 받아 **지문자 인식 학습**을 시작할 수 있다. 지문자는 이름·지명을 손으로
  쓰는 것이라, 되면 낱말 카드로 때우던 자리가 진짜 수어가 된다
- AI Hub에서 **수어영상 SEN 문장 목록** 찾기 — 있으면 일상 번역까지 학습 모델로
  넓힐 수 있다(지금 배포본에는 글로스만 있고 한국어 원문이 없다)
- 농인 당사자 평가 섭외
- 실기기에서 마이크·음성출력·카메라 확인

**남은 한계 (데이터가 없어서 못 하는 것)**
- **지문자(고유명사)** — 앱은 아직 못 읽고 못 쓴다. 낱말 카드로 정보 손실만 막아 둔 상태.
  다만 **데이터는 있다**(2026-08-18 확인). 수어영상 CROWD 조각에 지문자 클립
  17,000개·낱말 1,015종·자모 37종 133,986회. 가이드 표기 `FINSP`가 아니라 `FS`여서
  갈래 필터에 0건으로 걸려 오래 못 찾았다. 키포인트만 받으면 자모 CTC를 학습할 수
  있다 — `ml/jobs/run_fingerspell.sh` (**`AIHUB_APIKEY`가 필요하다**).
  아바타가 지문자를 쓰는 것은 자모별 구간이 없어 아직 길이 서 있지 않다.
- **비수지(표정)** — 우리 **가공본**에 없는 것이지 원본에 없는 것이 아니다(2026-08-18 정정).
  AI Hub 수어스크립트 원본에 8채널이 시간 구간까지 붙어 있다. 엑셀 25개만 세어도
  EBf(눈썹) 26,232 · Hno(고개 끄덕임) 15,685 · Mctr/Mo1(입) 23,398 · Ci 6,953 ·
  Mmo 2,505 · Hs(고개 흔들기) 648 · Tbt 72. 학습 파일은 225개다.
  다만 **`descriptor`(어떻게)는 `Mmo`(마우징, 한국어 낱말)만 채워져 있고 나머지는
  비어 있다** — "언제 움직이는지"는 알아도 "눈썹이 올라갔는지 찌푸렸는지"는 모른다.
  판정 의문문과 설명 의문문은 눈썹 방향이 반대라, **그건 규칙으로 지어내지 않는다.**
  바로 쓸 수 있는 것은 고개 끄덕임·흔들기(뜻이 분명하다)와 마우징, 그리고 눈썹을
  방향 없는 **운율**(강세·구 경계)로 쓰는 것까지다.
  아바타는 준비돼 있다 — `real-avaturn.glb`에 ARKit 52종 블렌드셰이프가 다 있다
  (browInnerUp·browDown·jawOpen·mouthFunnel…).
- 창구 낱말 중 처방전·번호표·등본·부작용 등은 **수어 클립 자체가 없다**.

---

## 작업 규칙

- 커밋 author는 **BioCode67 &lt;6wngud@gmail.com&gt;**, **AI 서명·Co-Authored-By를 넣지 않는다**
  (사용자 지시, `DECISIONS.md`에 기록됨)
- 작업 브랜치: `claude/sign-language-translation-system-a0mzqi`
- 판단이 필요한 결정을 내렸으면 `DECISIONS.md` 맨 아래에 근거와 함께 남긴다
- 주석과 문서는 한국어로 쓴다
- 정확도·성능을 말할 때는 **측정한 것만** 말한다. 추정치를 수치처럼 적지 않는다

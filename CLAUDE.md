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
  tools/             feature_parity(필수 검증) · schema_report(원본 구조 확인)
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
- 데이터 볼륨(`sbdata`) 미연결 — 현재 홈 50G뿐
- 브라우저 ONNX 연동은 실제 학습 모델이 나온 뒤에 붙인다

**다음 순서**
1. `sbdata` 볼륨 생성·연결 → 코드와 데이터를 그쪽으로 옮긴다
2. AI Hub「재난안전정보 수어영상」의 **라벨링데이터(형태소 JSON)만** 받는다.
   원천데이터(영상, TB급)는 받지 않는다 — 키포인트가 형태소 JSON 안에 이미 있다
3. `python -m ml.etl.aihub_disaster --input <라벨링> --out <데이터> --workers 16`
4. `python -m ml.etl.prepare --data <데이터> --split-by signer --min-count 5`
5. `stats.json`의 어휘 수·표본 수를 보고 목표 어휘 규모를 정한다 ← **첫 분기점**
6. `python -m ml.train_isolated --data <데이터> --out <runs>/iso-v1 --epochs 60`

---

## 작업 규칙

- 커밋 author는 **BioCode67 &lt;6wngud@gmail.com&gt;**, **AI 서명·Co-Authored-By를 넣지 않는다**
  (사용자 지시, `DECISIONS.md`에 기록됨)
- 작업 브랜치: `claude/sign-language-translation-system-a0mzqi`
- 판단이 필요한 결정을 내렸으면 `DECISIONS.md` 맨 아래에 근거와 함께 남긴다
- 주석과 문서는 한국어로 쓴다
- 정확도·성능을 말할 때는 **측정한 것만** 말한다. 추정치를 수치처럼 적지 않는다

# SignBridge ML — 수어 번역 시스템 학습 파이프라인

KOREN AI Cloud(GPU 워크스페이스)에서 **AI Hub 수어 데이터로 실제 인식 모델을 학습**하고,
그 결과를 브라우저(`src/recognition/*`)로 되돌리기 위한 코드다.

기존 저장소는 두 방향이 모두 "껍데기"까지는 완성돼 있었다.

| 방향 | 상태 |
|---|---|
| 텍스트 → 글로스 → 아바타 (출력) | 동작. 단 글로스 변환이 **규칙 기반** |
| 웹캠 → 랜드마크 → 자막 (입력) | 동작. 단 모델이 **합성 데이터** 학습본이라 실제 수어를 인식하지 못함 |

이 패키지가 채우는 것은 그 가운데의 **진짜 모델**이다.

---

## 1. 결론부터 — 권장 전략 5가지

### ① 영상이 아니라 **랜드마크**로 학습한다 (자원 형태가 그렇게 시킨다)

워크스페이스에 배정된 GPU는 `h200-mig-1g.35gb`, 즉 **H200의 MIG 슬라이스**다.
KOREN AI 허브 노드 소개서 기준 **FP32 17.14 TFLOPS**로, H200 전체(60 TFLOPS)의 **약 29%**다.
메모리는 35GB로 넉넉한데 연산은 그렇지 않다 — 이 비대칭이 설계를 결정한다.

- 영상(RGB) 3D CNN 학습 → 연산이 부족해 에폭당 수 시간. 이 자원으로는 비현실적.
- 랜드마크 시퀀스(프레임당 155 float) → 입력이 영상의 **약 1/2000**. 소형 트랜스포머로
  에폭당 수 분. **같은 시간에 20~50배 많은 실험**을 돌릴 수 있다.

정확도를 포기하는 선택이 아니다. 수어 인식에서 포즈 기반 모델은 영상 기반과 경쟁력이 있고,
가려짐·배경·조명·인물 외형에 강하며, 무엇보다 **그대로 브라우저에서 실시간으로 돈다**(1MB 미만).

### ② **학습 특징과 추론 특징을 기계적으로 일치**시킨다 ← 이 프로젝트 최대의 함정

가장 흔하고 가장 찾기 어려운 실패는 이것이다.

> 검증 정확도 95%인데 웹캠 앞에서는 아무것도 못 맞힌다.

원인은 대부분 학습(파이썬)과 추론(브라우저 TS)이 **미묘하게 다른 특징**을 쓰는 것이다.
그래서 `ml/signbridge/features.py`는 `src/recognition/landmarks.ts`의 정확한 포팅이고,
`ml/tools/feature_parity.py`가 **두 구현을 실제로 실행해 수치를 대조**한다.

```bash
python -m ml.tools.feature_parity      # 특징 정의를 건드릴 때마다 실행
```

> 이 검사를 만들자마자 실제 불일치가 하나 잡혔다. 손이 미검출일 때 TS는
> `(0 - 어깨중점) × 스케일`(= 몸 위치에 따라 매번 달라지는 값)을 넣고 있었다.
> 양쪽 모두 **0으로 남기도록** 고쳤다(`landmarks.ts`). 지금은 오차 0으로 일치한다.

### ③ 가능하면 **원본 영상을 MediaPipe로 재추출**한다

AI Hub는 **OpenPose** 키포인트를 준다. 브라우저는 **MediaPipe**로 뽑는다. 두 검출기는
관절 정의·지터·가림 처리가 다르고, 결정적으로 **OpenPose 2D에는 깊이(z)가 없다**
(155차원 중 51채널이 0). 이 상태로 학습하면 ②와 똑같은 실패로 간다.

| 경로 | 방법 | 품질 |
|---|---|---|
| **최선** | 원본 영상 → `etl/extract_mediapipe.py` | 학습·추론 완전 동일 |
| 차선 | `keypoints3d`가 있으면 깊이까지 사용 (`etl/aihub_to_packs.py`, 자동) | z가 실제 값 |
| 최후 | 2D OpenPose만 → 학습·추론 모두 `--zero-depth` | z를 양쪽에서 버려 일치 |

MediaPipe 추출은 **CPU 작업**이다(16 vCPU면 실시간의 20~30배속). GPU 잡을 점유하지 말 것.

> 이 저장소의 17개 클립을 조사한 결과 **9개에 `keypoints3d`가 들어 있었다**(mm 단위
> 카메라 좌표). 다만 깊이 추정 실패 프레임에 `-25,000,000` 같은 값이 섞여 있어
> 위생 검사(`openpose.sanitize_3d`)를 통과시켜야 쓸 수 있다. AI Hub 전량에도
> 3D가 얼마나 포함돼 있는지 먼저 확인할 가치가 있다.

### ④ **3단 구조**로 쪼갠다 — 한 번에 문장 번역을 노리지 않는다

```
① 단어(글로스) 인식      랜드마크 → 글로스        train_isolated.py   ← 먼저 여기까지
② 연속 수어 인식(CTC)    랜드마크열 → 글로스열     train_ctc.py
③ 언어 복원              글로스열 ↔ 한국어         train_gloss2text.py
```

"영상 → 자연스러운 한국어 문장"을 통째로 학습하는 것(end-to-end SLT)은 지금도 연구 주제이고
데이터가 훨씬 많이 필요하다. 반면 위 3단은 **각 단계가 독립적으로 검증·시연 가능**하다.
①만 되어도 실시간 자막 데모가 성립하고, ③은 키포인트 ETL이 끝나기 전에 라벨 텍스트만으로
먼저 학습할 수 있다.

③의 `--direction text2gloss`는 **지금 앱을 바로 개선한다.** 현재 `signAgent.ts`의 규칙 기반
글로스 변환을, AI Hub의 (한국어, 글로스) 쌍으로 학습한 모델로 교체하는 경로다.

### ⑤ 평가는 **수어자 분리(signer-disjoint)**로 한다

같은 사람이 학습·평가에 함께 있으면 모델은 그 사람의 버릇을 외운다. 정확도는 잘 나오고
실제 사용자에게는 실패한다. `etl/prepare.py --split-by signer`가 기본값인 이유다.
발표에 쓸 숫자는 반드시 이 기준으로 뽑을 것 — 심사에서 반드시 물어보는 지점이다.

---

## 2. 데이터셋 추천

### 주력 (AI Hub)

| 데이터 | 역할 | 메모 |
|---|---|---|
| **재난 안전 정보 전달을 위한 수어영상 데이터** | **최종 도메인**. 파인튜닝·평가 | 재난 문장 ↔ KSL, 형태소·비수지(표정)·키포인트 포함. 2021 구축 |
| **수어 영상** (dataSetSn=264) | **사전학습용 대규모 코퍼스** | 목표 **536,000 클립**, 언어제공자 20명 **5각도 동시 촬영**, 형태소·비수지 json + 30fps 키포인트 json |

핵심 전략은 **두 개를 붙여 쓰는 것**이다.

```
「수어 영상」 53만 클립으로 사전학습  →  「재난 수어」로 파인튜닝
      (도메인은 길찾기·교통·주소라 다르지만        (어휘·문체가 최종 목표와 일치)
       손모양·움직임의 일반 표현을 배운다)
```

재난 데이터만으로는 어휘당 표본이 부족할 가능성이 크다. 반대로 「수어 영상」만 쓰면
도메인이 어긋난다. **표현 학습은 큰 데이터, 어휘 적응은 작은 데이터** — 표준적이고 잘 통하는 조합이다.

「수어 영상」의 **5각도 동시 촬영**은 특히 값지다. 같은 동작을 여러 시점에서 본 데이터는
카메라 각도 변화에 강한 모델을 만든다(사용자 웹캠은 각도가 제각각이다). 각도별 클립을
같은 라벨로 넣기만 하면 된다.

### 파이프라인 검증용 (공개 벤치마크) — 강력 추천

**자기 데이터에서 성능이 안 나올 때, 코드 문제인지 데이터 문제인지 구분할 방법이 필요하다.**
공개 벤치마크에 같은 코드를 돌려 보면 그 구분이 즉시 된다.

| 데이터셋 | 용도 |
|---|---|
| **PHOENIX-2014T** (독일어 수어) | 연속 수어 인식(CTC)의 표준 벤치마크. WER 논문 수치와 직접 비교 가능 |
| **AUTSL** / **WLASL** | 단어 단위 인식. 포즈 기반 모델의 공개 baseline이 많음 |

CTC 구현이 맞는지 의심될 때 PHOENIX에 한 번 돌려 보는 것이, 한국어 데이터로 백 번
추측하는 것보다 빠르다.

### AI Hub 원본 다루기 — 미리 알아야 할 함정

이 저장소의 이전 ETL 작업(`DECISIONS.md`)에서 **실제로 확인된** 사항이다. 모르고 시작하면
하루씩 날아가는 것들이라 먼저 적는다.

| 함정 | 실제 |
|---|---|
| 라벨 아카이브가 안 풀림 | 확장자는 `.zip`인데 **내용은 7-Zip**. `unzip`·파이썬 `zipfile` 실패 → **`bsdtar`**(libarchive) 사용 |
| 키포인트 XML이 6.96GB | **받을 필요 없음.** 키포인트는 **형태소 JSON의 `landmarks` 필드**에 이미 들어 있다 |
| 3D 좌표 처리 | 3D 랜드마크 + 카메라 내부 파라미터(`intrinsic_F`) 제공. 2D로 투영할 수도 있으나, **이 파이프라인은 3D를 그대로 쓰는 게 낫다**(브라우저 입력에 z가 있으므로) |
| 다운로드가 안 끝남 | INNORIX 클라이언트 사용, 미완료 파일이 `.irx961`로 남는다 |
| 좌표 정규화 붕괴 | 이전 변환기가 min/max 정규화를 쓰자 이상치 Z(≈0)로 골격이 한 점으로 붕괴 → **퍼센타일(2~98%)** 기준으로 해결 |

### 재난안전 데이터 전용 어댑터 ★

**공식 구축 가이드라인(V1.1)의 스키마 표를 근거로** 작성했다(추측이 아니다).

```bash
python -m ml.etl.aihub_disaster --input /data/raw/재난안전/라벨링데이터 \
    --out /data/signbridge/ksl-disaster --workers 16
```

가이드라인에서 확인된, 반드시 알아야 할 세 가지.

| 사실 | 왜 중요한가 |
|---|---|
| 글로스가 **`sign_gestures_both` / `_strong`(우세손) / `_weak`(비우세손)** 세 층렬로 나뉜다 | 한 줄짜리 시퀀스가 아니다. 합쳐서 시간순 정렬해야 한다(`--tiers`) |
| 글로스 필드 이름이 **`gloss_id`** | `gloss`·`name`으로 찾으면 0건이 나온다 |
| 키포인트가 **형태소 JSON의 `landmarks`** 안에 있다 | 별도 키포인트 XML(수 GB)을 받을 필요가 없다 |

그 밖에 학습·평가에 직접 쓰이는 메타 필드도 함께 뽑는다.

- **`signer`** — 수어자 분리 평가의 근거(`prepare.py --split-by signer`)
- **`augment`** — AI 증강 문장 여부. `prepare.py --exclude-augmented`로 제외 가능
- **`filmed_in_studio`** — 대면(스튜디오) / **비대면 촬영**. 비대면 쪽이 실제 웹캠 환경에
  더 가까우므로 `--only-remote`로 그것만 골라 쓸 수 있다
- `hand_default` — 우세손(좌우 반전 증강을 근거 있게 쓰려면 필요)

### 「수어 영상」 전용 어댑터 ★ (사전학습용)

**재난안전과 구조가 다르다.** 헷갈리면 0건이 나온다.
아래 표는 공식 가이드 + **실제 배포본 샘플을 열어 확인한** 내용이다.

| | 재난안전 | 수어 영상 |
|---|---|---|
| 키포인트 위치 | 형태소 JSON 안(`landmarks`) | **별도 파일, 프레임당 1개** |
| 좌표 | 3D | **2D·3D 둘 다** — 3D는 미터 단위라 그대로 쓴다(`--force-2d`로 2D 강제 가능) |
| 글로스 필드 | `sign_script.*[].gloss_id` | **`data[].attributes[].name`** |
| 수어자 정보 | `signer` 필드 | **파일명**(REAL01~20) |

```bash
python -m ml.etl.aihub_sl \
    --morpheme /data/raw/수어영상/라벨링데이터 --keypoints /data/raw/수어영상/라벨링데이터 \
    --out /data/signbridge/ksl-sl --angles F --workers 16
python -m ml.etl.prepare --data /data/signbridge/ksl-sl --split-by content
```

**파일명이 곧 메타데이터다**(공식 가이드 표2·표3).

```
NIA_SL_[SEN|WRD|FINSP]XXXX_[REAL|SYN|CROWD]XX_[F|U|D|R|L]
        └ 콘텐츠 번호        └ 수어자(20명)      └ 촬영각도
```

여기서 세 가지가 바로 나온다 — **수어자**(분리 평가), **각도**(5각도 다시점),
**콘텐츠 번호**(같은 문장이 학습·평가에 걸치지 않게). 그래서 `--split-by content`를 쓴다.
`--angles all`로 5각도를 모두 넣으면 데이터가 5배가 되고 카메라 각도에 강해진다.
(크라우드소싱은 단방향이라 `F`만 존재한다.)

### 다운로드 계획 — 영상은 받지 않는다

공식 파일 목록의 실제 용량이다. **이 표가 전략을 결정한다.**

| 구분 | 용량 | 판단 |
|---|---|---|
| 형태소(morpheme) zip 전체 | **약 0.2 GB** | 글로스만 필요하면 이것만 받아도 된다 |
| 키포인트(keypoint) zip 전체 | **약 400 GB** | **900 GiB 쿼터 안에 들어간다** |
| 원천 영상(video) zip 전체 | **약 2 TB** | 들어가지 않는다. 받지 말 것 |

즉 **영상 없이 키포인트만으로 사전학습이 가능하다.** MediaPipe 재추출이 품질상 더 낫지만,
그건 영상 2TB가 필요하다. 먼저 키포인트로 돌려 보고, 도메인 갭이 실제로 문제가 될 때만
영상을 배치 단위로 받아 재추출한다(`KOREN_SETUP.md`의 "배치 후 삭제" 참고).

> 다운로드는 분할 압축으로 온다. 병합에 리눅스 명령이 필요하다:
> `find <폴더> -name "파일명.zip.part*" -print0 | sort -zt'.' -k2V | xargs -0 cat > 파일명.zip`

### 그 밖의 형식

- `--format repo` : 이 저장소 `public/data/sign_N.json` — 직접 확인·검증 완료
- `--format openpose-dir` : OpenPose 표준 출력 규약. AI Hub 배포본이 그 형태라고
  확인된 것은 아니다

배포 차수마다 필드가 다를 수 있으니, **처음 받으면 구조부터 찍어 볼 것.**

```bash
# 데이터를 어디에 올릴 필요 없다. 있는 자리에서 실행하고 출력 텍스트만 가져오면 된다.
python3 ml/tools/schema_report.py /data/raw/재난안전/라벨링데이터 --limit 3
python3 ml/tools/schema_report.py 샘플데이터.zip     # 압축 해제 없이 바로 읽는다
```

`schema_report.py`는 **표준 라이브러리만 쓰는 단일 파일**이라 저장소 clone도 pip install도
필요 없다. 파일 하나만 옮겨 실행해도 된다. 좌표는 개수·범위로, 문자열은 앞 40자만 요약하므로
출력이 보통 2~5KB이고 원문·좌표가 그대로 새어 나가지 않는다. 어떤 어댑터를 쓸지도 판정해 준다.

---

## 3. 전체 실행 절차

> 아래 `/data/...` 경로는 **예시**다. KOREN에서는 볼륨의 실제 마운트 경로를 확인해 바꿔 쓴다
> (`KOREN_SETUP.md` 참고). 홈(`/home/jovyan`)은 워크스페이스 삭제 시 함께 사라지므로
> **코드·데이터·체크포인트를 홈에 두지 말 것.**

```bash
# 0) 환경 점검 — 데이터 없이 GPU·학습 루프·저장이 도는지 먼저 확인
python -m ml.train_isolated --synthetic --epochs 3

# 1) 특징 일치 검증 (Node 22 필요)
python -m ml.tools.feature_parity

# 2) ETL — 둘 중 하나
python -m ml.etl.extract_mediapipe \            # ★ 영상이 있으면 이쪽 (CPU 잡)
    --videos /data/aihub/원천데이터 --labels /data/aihub/라벨링데이터 \
    --out /data/signbridge/ksl --workers 14 --resume

python -m ml.etl.aihub_to_packs \               # 키포인트만 있으면 이쪽
    --format openpose-dir --input /data/aihub/원천데이터 \
    --labels /data/aihub/라벨링데이터 --out /data/signbridge/ksl --workers 16

# 3) 분할 + 글로스 사전
python -m ml.etl.prepare --data /data/signbridge/ksl --split-by signer --min-count 5

# 4) 단어 인식 학습
python -m ml.train_isolated --data /data/signbridge/ksl \
    --out runs/isolated-v1 --epochs 60 --batch-size 128

# 5) 연속 인식(CTC) — 4의 인코더를 물려받으면 수렴이 빠르다
python -m ml.train_ctc --data /data/signbridge/ksl \
    --out runs/ctc-v1 --epochs 80 --init-from runs/isolated-v1/best.pt

# 6) 언어 단계 (GPU 거의 안 씀 — 키포인트 ETL과 병행 가능)
python -m ml.train_gloss2text --data /data/signbridge/ksl --direction gloss2text
python -m ml.train_gloss2text --data /data/signbridge/ksl --direction text2gloss

# 7) 브라우저용 내보내기
python -m ml.export_onnx --checkpoint runs/isolated-v1/best.pt \
    --out public/models/ksl-transformer --quantize
```

---

## 4. 지금까지 검증된 것 / 안 된 것

이 저장소의 실제 AI Hub 키포인트(17클립, 209개 글로스 구간)로 **전 구간을 실행**했다.

| 항목 | 결과 |
|---|---|
| TS ↔ 파이썬 특징 일치 | **최대 오차 0.000e+00** (240 프레임, 손 유무·경계 조건 포함) |
| 일치 검사 자체의 유효성 | TS를 일부러 되돌리자 오차 7.7로 **검출됨** |
| ETL (repo 형식) | 17클립 → 209 글로스 구간. 3D 포함 9클립 자동 감지 |
| 분할·사전 생성 | 74개 글로스 관측 → min_count=2에서 19개 유지 |
| 단어 인식 학습 | 실행·저장·재개 정상 |
| 연속 인식(CTC) 학습 | 실행·WER 계산 정상 |
| ONNX 내보내기 | fp32 대비 오차 **1.5e-07**, int8 3.2× 축소 |
| ONNX 동적 축 | 배치 1·3·4, 프레임 32·97·256 모두 정상 |
| **torch 2.5.1**(KOREN 기본) **/ 2.13** | 학습·내보내기 **양쪽 버전에서 실행 검증** |
| 글로스↔한국어 쌍 구성 | 정상 (모델 학습은 transformers 설치 후) |

**아직 안 된 것 (정직하게)**

- **정확도 수치는 아직 없다.** 17클립·55 학습표본으로는 어떤 숫자도 의미가 없다.
  실제 성능은 AI Hub 전량을 받은 뒤에야 말할 수 있다.
- MediaPipe 재추출은 이 환경에 `mediapipe`·`opencv`가 없어 **미실행**이다.
  코드 경로는 작성돼 있으나 워크스페이스에서 첫 실행 시 확인이 필요하다.
- 브라우저 ONNX 연동(`onnxruntime-web`)은 **아직 붙이지 않았다.** 실제 학습된 모델이
  나온 뒤에 붙이는 편이 낫다(그때 입력 파이프라인까지 함께 검증 가능).

---

## 5. 현실적인 기대치

수어 인식은 "카메라 켜면 문장이 나온다"가 쉽게 되는 문제가 아니다. 단계별 목표를 이렇게 잡는 게 맞다.

| 단계 | 목표 | 시연 가능한 것 |
|---|---|---|
| 1 | 재난 어휘 **30~50단어** 인식, 수어자 분리 top-1 **80%+** | 실시간 단어 자막 |
| 2 | 어휘 **300~500단어** | 실용적인 키워드 자막 |
| 3 | 연속 수어 WER **50% 이하** | 문장 단위 자막(거칠지만 의미 전달) |
| 4 | 글로스 → 자연스러운 한국어 | 완성형 번역 데모 |

1단계만 제대로 해도 **합성 데이터 한계를 넘은 실제 동작 시스템**이 된다.
공모전 관점에서는 "30단어를 정직하게 잘하는 것"이 "1000단어를 흉내만 내는 것"보다 강하다.

---

## 6. 파일 구성

```
ml/
├─ signbridge/
│  ├─ features.py       ★ 155차원 특징 — landmarks.ts와 반드시 일치
│  ├─ openpose.py         OpenPose(2D/3D) → MediaPipe 토폴로지 + 3D 위생검사
│  ├─ pack.py             랜드마크 팩(.npz) 입출력
│  ├─ vocab.py            글로스 사전(CTC blank=0)
│  ├─ dataset.py          단어 단위 / 연속 데이터셋
│  ├─ augment.py          특징 공간 증강(회전·스케일·관절드롭아웃 등)
│  ├─ models.py           Conv 프런트엔드 + 트랜스포머 인코더 + 과제별 헤드
│  └─ metrics.py          CTC 그리디 디코드, WER
├─ etl/
│  ├─ inspect_json.py     AI Hub 원본 구조 확인
│  ├─ aihub_to_packs.py   키포인트 → 팩
│  ├─ extract_mediapipe.py ★ 영상 → 팩 (권장)
│  └─ prepare.py          분할 + 사전 + 통계
├─ tools/feature_parity.py ★ TS↔파이썬 특징 일치 검증
├─ train_isolated.py      단어 인식
├─ train_ctc.py           연속 인식
├─ train_gloss2text.py    글로스 ↔ 한국어
├─ export_onnx.py         브라우저용 내보내기
└─ jobs/                  KOREN 잡 스케줄링 스크립트
```

KOREN 문서 두 개를 함께 본다.

- **[KOREN_RESOURCES.md](KOREN_RESOURCES.md)** — AI Cloud·HPC·KOREN VM 세 자원 중
  **어떤 작업을 어디서 돌릴지**. 먼저 읽을 것.
- **[KOREN_SETUP.md](KOREN_SETUP.md)** — AI Cloud 워크스페이스·볼륨·잡 운영 절차.

---

## 출처

- [AI Hub — 수어 영상 데이터셋](https://www.aihub.or.kr/aihubdata/data/view.do?currMenu=115&topMenu=100&dataSetSn=264)
- [AI Hub — 재난 안전 정보 전달을 위한 수어영상 데이터](https://www.aihub.or.kr/aihubdata/data/view.do?currMenu=115&topMenu=100&aihubDataSe=realm&dataSetSn=636)

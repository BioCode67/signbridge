# KOREN 자원 3종 — 무엇을 어디서 돌릴 것인가

KOREN에서 쓸 수 있는 자원이 셋인데, **성격이 완전히 다르다.** 하나로 다 하려 하면
어느 쪽도 제대로 안 된다. 이 문서는 "어떤 작업을 어느 자원에" 를 정한다.

---

## 1. 세 자원을 한 줄로

| 자원 | 접속 | 하드웨어 | 한마디로 |
|---|---|---|---|
| **AI Cloud (CHEETAH)** | `116.89.177.100:8080` (웹) | **H200 MIG 35GB ×1**, vCPU 16, RAM 128Gi | 최신 GPU 한 대. **학습 전용** |
| **HPC 이노베이션 허브** | `cloud.openhpc.or.kr` (웹+전용 클라이언트) | Xeon Gold 6140 **8~16코어 VM 여러 대**, 선택적 V100 16GB | CPU 일꾼 여러 명. **전처리 전용** |
| **KOREN VM** | SSH (NOC 발급) | 별도 협의 | 24시간 켜 두는 **서버. 데모 호스팅** |

비유하자면 이렇다.

- **AI Cloud** = 성능 좋은 오븐 한 대 — 굽기(학습)만 시켜야 한다. 재료 손질에 쓰면 아깝다.
- **HPC** = 손질 담당 주방보조 여러 명 — 재료 손질(영상→랜드마크)을 나눠서 시킨다.
- **KOREN VM** = 가게 카운터 — 손님(심사위원)이 와서 보는 곳.

---

## 2. 작업을 어디에 배치하나

```
[AI Hub 원본 영상]
        │
        ▼
┌───────────────────────────────┐
│  HPC VM 여러 대 (CPU)          │   ← 며칠 걸리는 CPU 작업
│  MediaPipe 랜드마크 추출        │      VM 4대면 4배 빠르다
│  → 랜드마크 팩(.npz)           │
└───────────────────────────────┘
        │  팩만 옮긴다 (영상의 수천분의 1 크기)
        ▼
┌───────────────────────────────┐
│  AI Cloud H200 (GPU)          │   ← GPU가 놀지 않는다
│  모델 학습 · 평가 · ONNX 내보내기 │
└───────────────────────────────┘
        │  모델 파일 (약 1~4MB)
        ▼
┌───────────────────────────────┐
│  KOREN VM                     │   ← 상시 가동
│  데모 웹앱 + Q&A 서버 호스팅     │
└───────────────────────────────┘
```

**이 구조의 핵심은 "옮기는 게 작다"는 것이다.** 원본 영상은 TB급이라 못 옮기지만,
랜드마크 팩은 **프레임당 약 0.5KB**라 450시간 분량이 25GB 정도다. 모델은 몇 MB다.
그래서 무거운 건 각자 자리에 두고 가벼운 것만 넘긴다.

---

## 3. 각 자원에서 실제로 하는 일

### 3-1. HPC — 랜드마크 추출을 여러 대로 쪼개기

HPC는 **VM을 2대 이상 만들면 PBS Torque 스케줄러와 passwordless SSH가 자동 구성**된다.
이 파이프라인의 추출 작업은 클립마다 독립적이라 나누기가 아주 쉽다.

```bash
# VM 4대에 나눠 제출
for i in 0 1 2 3; do
  qsub -v SHARD=$i,NUM_SHARDS=4 ml/jobs/pbs_extract.sh
done

# 전부 끝나면 인덱스 합치기
python -m ml.etl.merge_index --data "$DATA_ROOT"
```

샤드는 **정렬된 전체 목록**을 `[shard::num_shards]`로 나누므로 겹침도 누락도 없고,
`--resume`과 함께 써도 안전하다. 각 노드는 자기 인덱스 파일
(`index.shard000.jsonl` …)에만 쓰고, `merge_index`가 합치면서 중복과
**팩이 실제로 없는 레코드**(노드가 중간에 죽은 경우)를 걸러낸다.

**HPC VM 사용 시 알아 둘 것**

- 클라이언트는 **Windows 11** 필요. Launcher·ProxyCap·Enterm·WinSCP·VNCviewer를 설치해야 한다.
- VM 생성에 **10~15분** 걸린다.
- 접속이 안 되면 **ProxyCap이 Enable인지** 먼저 확인(FAQ 1순위 항목).
- 기본 이미지에 `vim`·`gcc`·`net-tools`조차 없다. `sudo apt-get install build-essential` 등으로 채워야 한다.
- 포트 포워딩은 **10000~15000** 범위.
- 개별 생성한 VM끼리는 자동 연결되지 않는다. **반드시 "다중 시스템 생성"으로 한 번에** 만들 것.

### 3-2. AI Cloud — 학습만

여기서는 GPU가 필요한 것만 한다.

```bash
python -m ml.train_isolated --data "$DATA_ROOT" --out "$RUNS_ROOT/iso-v1" --amp bf16
python -m ml.train_ctc      --data "$DATA_ROOT" --out "$RUNS_ROOT/ctc-v1" --amp bf16
python -m ml.export_onnx    --checkpoint "$RUNS_ROOT/iso-v1/best.pt" --out onnx --quantize
```

### 3-3. HPC의 V100을 보조 학습기로 쓰기 (선택)

HPC VM에는 **NVIDIA V100 16GB**를 붙일 수 있다. 이 모델은 파라미터가 2.8M로 작아
16GB로 충분하다. 즉 **H200에서 본 실험을 돌리는 동안 V100에서 하이퍼파라미터 변형을
병렬로** 돌릴 수 있다. GPU 할당량이 1개라는 제약을 우회하는 방법이다.

> ⚠️ **V100에서는 `--amp bf16`을 쓰면 안 된다.** V100은 Volta 세대라 bf16 연산이 없다
> (bf16은 Ampere 이후). **`--amp fp16`** 으로 바꿔야 한다. 그냥 두면 느려지거나 죽는다.
>
> ```bash
> python -m ml.train_isolated --data "$DATA_ROOT" --amp fp16 --out runs/v100-exp1
> ```
> fp16은 손실 스케일링이 필요한데, 학습 스크립트가 `--amp fp16`일 때만 GradScaler를
> 켜도록 이미 되어 있다.

### 3-4. KOREN VM — 데모 호스팅

최종 시연 대상이다. NOC이 방화벽 정책을 잡아 주므로 외부에서 접근 가능한 서비스에 맞다.

- 프런트엔드(`npm run build` → `dist/`) 정적 호스팅
- Q&A 백본 서버(`server/app.py`, FastAPI)
- 기획안의 "KOREN 저지연망으로 전국 송출" 서사와 직접 연결되는 지점

---

## 4. 신청·문의처

| 대상 | 창구 |
|---|---|
| **KOREN NOC 계정** (모든 자원의 전제) | KOREN NOC |
| **HPC / VM 자원** | TTA 최은수 책임연구원 — `eunsoo.choi@tta.or.kr` |
| **KOREN VM 설정·방화벽 정책** | KOREN NOC 기술지원 — `netcc@koren.kr` |
| **AI Cloud(CHEETAH) 운영** | `jilee@jininfra.com` |
| HPC 사용 문의 | `cloud.openhpc.or.kr` 내 Q&A 게시판 |

계정은 **메일로 랜덤 초기 비밀번호**가 온다. 메일 본문 링크로 접속해 로그인한다.

---

## 5. 권장 진행 순서

**지금 당장 (자원 신청 기다릴 필요 없음)**

1. AI Cloud에 볼륨 만들고 스모크 테스트
2. AI Hub **형태소 JSON**만 받아서 ETL → 첫 학습
   (키포인트가 JSON 안에 이미 있으므로 영상도, HPC도 필요 없다)

**병행해서 신청**

3. HPC/VM 계정 신청 (위 문의처). 승인·교육에 시간이 걸리므로 **지금 넣어 둔다**

**나중에, 필요해지면**

4. 1단계 모델이 웹캠에서 잘 안 되면 → HPC VM 여러 대로 MediaPipe 재추출
5. 데모가 안정되면 → KOREN VM에 올려 상시 시연 환경 구성

> **핵심**: HPC와 KOREN VM은 **지금 당장 필요한 게 아니다.** 계정만 미리 신청해 두고,
> 실제 작업은 AI Cloud에서 시작하면 된다. 세 자원을 다 세팅하고 시작하려 하면
> 아무것도 시작하지 못한 채 몇 주가 지나간다.

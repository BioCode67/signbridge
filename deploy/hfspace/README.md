---
title: SignBridge API
emoji: 🤟
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
license: apache-2.0
short_description: 재난 문자를 한국수어 글로스·아바타 동작으로 번역하는 API
---

# SignBridge API

재난 안전 문자를 **한국수어(KSL)** 로 번역하는 백엔드입니다.
[SignBridge](https://biocode67.github.io/signbridge/) 데모 사이트가 이 API를 호출합니다.

```
재난 문장 → (KoBART) 글로스열 → (동작 사전) 3D 아바타 키포인트
```

## 엔드포인트

| 경로 | 하는 일 |
|---|---|
| `GET /health` | 모델·사전 적재 상태 |
| `POST /t2g` | 한국어 문장 → 글로스열 |
| `POST /compose` | 한국어 문장 → 아바타가 재생할 키포인트 시퀀스 |
| `POST /qa` | 재난 상황 질의응답 (KoGPT2) |

```bash
curl -X POST https://<이 Space 주소>/t2g \
  -H 'Content-Type: application/json' \
  -d '{"text": "오늘 밤 한파주의보가 발효됩니다."}'
```

## 모델

- **text2gloss**: KoBART(`gogamza/kobart-base-v2`)를 AI Hub「재난 안전 정보 전달을 위한
  수어영상 데이터」의 (한국어, 글로스열) 16만 쌍으로 파인튜닝
- **동작 사전**: 같은 데이터 16만 클립에서 글로스별로 가장 잘 촬영된 실연 구간을 선별.
  실제 농인 수어자 53명의 OpenPose 키포인트(2D/3D)

무료 CPU 티어에서 동작합니다. 48시간 미사용 시 절전되며, 첫 요청에 1분쯤 걸립니다.

## 자산 배치

모델과 동작 사전은 용량이 커서 이 저장소에 두지 않습니다. Space **Settings → Variables**
에 아래를 넣으면 시작 시 내려받습니다.

| 변수 | 값 |
|---|---|
| `T2G_MODEL_URL` | `t2g-best.tar.gz` 직링크 |
| `GLOSS_BANK_URL` | `glossbank.tar.gz` 직링크 |

HF 데이터셋 저장소에 올렸다면 링크는 이런 형태입니다:
`https://huggingface.co/datasets/<계정>/signbridge-assets/resolve/main/t2g-best.tar.gz`

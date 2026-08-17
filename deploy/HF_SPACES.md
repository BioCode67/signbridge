# HF Spaces 배포 — 따라 하기

프런트(GitHub Pages)는 그대로 두고, **AI 백엔드만** Hugging Face Spaces 무료 CPU에 올린다.
무료 티어는 2 vCPU · 16GB RAM이라 KoBART(가중치 475MB)에 여유롭다.
(Render 무료·Starter는 512MB라 이 모델이 올라가지 않는다. 그래서 HF를 고른다.)

---

## 1. 자산 업로드 (대용량 파일)

모델과 동작 사전은 코드 저장소에 넣지 않는다. **데이터셋 저장소**에 올린다.

워크스페이스에서 묶기:

```bash
bash deploy/pack_assets.sh
```

`~/deploy/`에 두 파일이 생긴다. 파일 브라우저로 내려받는다.

| 파일 | 내용 |
|---|---|
| `t2g-best.tar.gz` | KoBART text2gloss 파인튜닝 모델 (~439MB) |
| `glossbank.tar.gz` | 글로스별 실연 동작 사전 |

huggingface.co 로그인 → 우측 상단 **+ → New Dataset**
- 이름: `signbridge-assets`
- 공개(Public)로 두면 Space가 토큰 없이 받을 수 있다

**Files → Add file → Upload files** 로 두 tar.gz를 올린다.
업로드 후 각 파일의 링크는 이 형태다:

```
https://huggingface.co/datasets/<계정>/signbridge-assets/resolve/main/t2g-best.tar.gz
https://huggingface.co/datasets/<계정>/signbridge-assets/resolve/main/glossbank.tar.gz
```

> `resolve/main/`이어야 실제 파일이 내려온다. `blob/main/`은 웹 페이지라 안 된다.

---

## 2. Space 만들기

**+ → New Space**
- 이름: `signbridge-api`
- SDK: **Docker** (Blank 템플릿)
- Hardware: **CPU basic — free**
- 공개(Public)

`deploy/hfspace/` 안의 파일을 그대로 Space 저장소에 올린다:

```
README.md        ← Space 설정(YAML 머리말) 포함, 반드시 최상위
Dockerfile
requirements.txt
server/app.py
server/fetch_assets.py
```

웹에서 **Files → Add file → Upload files** 로 통째로 올려도 되고, git으로 해도 된다:

```bash
git clone https://huggingface.co/spaces/<계정>/signbridge-api
cp -r deploy/hfspace/. signbridge-api/
cd signbridge-api && git add -A && git commit -m "SignBridge API" && git push
```

---

## 3. 자산 URL 연결

Space → **Settings → Variables and secrets → New variable**

| 이름 | 값 |
|---|---|
| `T2G_MODEL_URL` | 1단계의 `t2g-best.tar.gz` 링크 |
| `GLOSS_BANK_URL` | 1단계의 `glossbank.tar.gz` 링크 |

(비밀이 아니므로 Secret이 아니라 **Variable**로 넣는다. Secret은 빌드 로그에서 가려질 뿐
동작은 같지만, 공개 자산이니 Variable이 맞다.)

저장하면 Space가 자동으로 다시 빌드된다. 첫 빌드는 torch 설치 때문에 5~10분 걸린다.

---

## 4. 확인

```bash
curl https://<계정>-signbridge-api.hf.space/health
```

이렇게 나오면 성공:

```json
{"ok": true, "t2g_ready": true, "bank_glosses": 8000}
```

번역 시험:

```bash
curl -X POST https://<계정>-signbridge-api.hf.space/t2g \
  -H 'Content-Type: application/json' \
  -d '{"text": "산불이 확산 중이니 즉시 대피하세요."}'
```

---

## 5. 프런트를 이 API에 연결

이 주소를 넣고 다시 빌드해 gh-pages에 배포한다:

```bash
VITE_API_URL=https://<계정>-signbridge-api.hf.space npm run build
```

`src/config.ts`가 이 값을 읽어 모든 호출부(`/compose`·`/t2g`·`/qa`)에 적용한다.
값이 없으면 `localhost:8000`으로 떨어지므로 로컬 개발은 그대로다.

---

## 알아둘 것

- **절전**: 무료 티어는 48시간 미사용 시 잠든다. 깨우는 데 30초~1분. 프런트에 안내
  문구를 넣어 뒀다. **발표 직전에 한 번 열어 깨워 둘 것.**
- **CORS**: `server/app.py`가 `allow_origins=["*"]`이라 GitHub Pages에서 바로 호출된다.
- **자산 없이도 뜬다**: URL을 안 넣으면 서버는 정상 기동하고 `/t2g`가
  `backend: "unavailable"`을 반환한다. 사이트는 수록 문장 데모로 계속 동작한다.
- **KoGPT2**(Q&A)는 첫 호출 때 HF에서 자동으로 받는다(~500MB). 별도 업로드 불필요.

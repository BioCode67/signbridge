# 고정 주소로 옮기기 (PaaS 배포)

지금 시연 주소는 무료 터널이라 **60분마다 주소가 바뀝니다.** 아래대로 하면 고정
주소가 생기고, 그 뒤로는 `npm run build` 한 번이면 갱신됩니다.

## 먼저 알아야 할 것

이 앱은 **서버가 필요 없습니다.** 인식(ONNX)·번역(사전)·아바타 합성이 전부
브라우저 안에서 돕니다. 그래서 정적 호스팅이면 어디든 됩니다.

다만 **HTTPS는 선택이 아니라 필수**입니다 — 카메라·위치·서비스워커가 HTTPS에서만
동작합니다. 아래 방법은 모두 HTTPS를 자동으로 줍니다.

실측 용량 (`npm run build` 뒤 `dist/`):

| | 크기 | 파일 수 |
|---|---|---|
| 전체 | **약 361MB** | **약 11,600개** |
| └ 동작 조각 `data/glosses` | 257MB | 11,464 |
| └ MediaPipe(랜드마크) | 32MB | 5 |
| └ ONNX 인식 모델 | 19.6MB | 1 |
| └ ORT wasm | 13.5MB | 1 |
| └ 번역 사전 | 5.5MB | 1 |

## 권장 — Cloudflare Pages

무료이고 **대역폭 제한이 없습니다**(다른 곳은 월 100GB에서 막힙니다).
파일 2만 개·파일당 25MB까지라 지금 규모가 들어갑니다.

### 방법 A — 웹에서 끌어다 놓기 (계정만 있으면 5분)

1. `npm run build`
2. dash.cloudflare.com → Workers & Pages → Create → Pages → **Upload assets**
3. `dist/` 폴더를 통째로 끌어다 놓기
4. 나오는 `*.pages.dev` 주소가 고정 주소입니다

### 방법 B — 깃에 연결 (한 번만 해 두면 그 뒤로 자동)

1. Pages → Connect to Git → 이 저장소 선택
2. 빌드 명령 `npm run build` · 출력 디렉터리 `dist`
3. 그 뒤로는 **푸시하면 자동으로 새 주소에 반영**됩니다

### 방법 C — 명령줄

```bash
npm i -g wrangler          # 한 번만
wrangler login             # 브라우저가 열립니다
npm run build
wrangler pages deploy dist --project-name signbridge
```

## 이미 들어 있는 것

- `public/_headers` — 캐시 규칙과 권한 정책. 해시 붙은 번들은 영구 캐시하고,
  동작 조각·모델은 하루만 캐시합니다. **서비스워커와 index.html은 캐시 금지**
  (캐시되면 새 배포가 영영 안 내려갑니다).
- `public/_redirects` — 잘못된 경로로 들어와도 앱이 뜨도록 index.html로.
- `vite.config`의 `base: './'` — 하위 경로에 올려도 그대로 동작합니다.

Netlify도 이 두 파일을 같은 형식으로 읽습니다(그대로 올리면 됩니다).

## 다른 곳을 쓸 경우 주의할 점

| | 걸리는 점 |
|---|---|
| Netlify · Vercel | 무료 대역폭 월 100GB. 오프라인 전체 세트가 72MB라 **몇 사람만 받아도 찹니다** |
| GitHub Pages | 저장소에 361MB가 들어가고, 동작 사전을 다시 만들 때마다 1만 개 파일이 다시 커밋됩니다 |
| KOREN VM | 용량·대역폭 제한은 없지만 HTTPS 인증서와 서버 관리가 우리 몫이고, VM이 꺼지면 사이트도 꺼집니다 (`~/deploy/koren-vm/설치.sh`) |

## 파일 수가 한도에 닿으면

동작 조각이 낱말마다 파일 하나입니다(지금 11,464개). `iso-v2`로 인식 어휘가
13,576종이 되면 사전도 함께 커집니다. Cloudflare 한도는 2만 개라 아직 여유가
있지만, 닿으면 조각을 100개쯤의 묶음 파일로 합치고 색인을 붙이면 됩니다
(재생 코드와 오프라인 매니페스트를 함께 고쳐야 해서 반나절 일입니다).

## 배포한 뒤 확인

```bash
npm run build && python3 scripts/e2e_app.py    # 폰·태블릿·키오스크·오프라인
python3 scripts/shots.py                        # 화면 사진
```

그리고 **실제 폰에서** 한 번은 눌러 봐야 합니다 — 마이크·음성 출력·카메라는
실기기에서만 확인됩니다.

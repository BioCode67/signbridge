/* SignBridge 서비스워커 — 재난 도구는 오프라인에서도 동작해야 한다.
 *
 * 재난 상황은 기지국 폭주·정전으로 네트워크가 가장 먼저 불안해지는 순간이다.
 * 한 번이라도 방문한 사용자는 그 뒤 오프라인에서도 앱 셸·아바타·동작 사전이
 * 열리도록, 지나간 응답을 캐시에 쌓는 전략을 쓴다(런타임 캐시).
 *
 * 전략
 *  - 문서(HTML): network-first — 새 배포를 우선 받고, 실패하면 캐시로.
 *  - `assets/`(해시 파일명): cache-first — 내용이 바뀌면 이름이 바뀌므로 불변이다.
 *  - **그 밖의 전부(data/·models/·ort/·mediapipe/): stale-while-revalidate**
 *    — 캐시를 즉시 돌려주고 뒤에서 새것을 받아 갈아 끼운다.
 *
 * **왜 cache-first를 버렸나.** `data/align.json`·`data/glosses/*`·`models/ksl-iso/
 * model.onnx`는 이름이 그대로다. 캐시 우선으로 두면 **번역 사전을 다시 만들어도,
 * 인식 모델을 갈아 끼워도, 한 번 방문했던 사람에게는 영영 옛것이 나간다.**
 * 캐시 이름(VERSION)은 JS 번들 해시로 만드는데, 사전만 바뀐 배포에서는 번들이
 * 그대로라 버전도 그대로다 — 즉 자동으로 풀리지도 않는다.
 *
 * 이 프로젝트에서 이미 같은 모양으로 당했다: 60에폭을 돌리는 동안 앱에는 에폭
 * 27짜리 모델이 붙어 있었고, 화면상 차이가 없어 아무도 몰랐다.
 *
 * 뒤에서 다시 받는 비용은 크지 않다 — 조건부 요청이라 안 바뀌었으면 304로 끝난다
 * (`public/_headers`가 must-revalidate로 잡아 둔다).
 */
const VERSION = 'sb-CTWxoCdx'
const CORE = ["./","./manifest.webmanifest","./icon-192.png","./icon-512.png","./assets/AskMode-DcPMbCv1.js","./assets/Avatar3D-5wGJ-cy5.js","./assets/DirectionMap-BcRLWnwp.js","./assets/Landing-DjUZ_xZP.js","./assets/MyInfoPanel-sChHFsaP.js","./assets/RecognizedWords-BMdobmuU.js","./assets/SignInputPanel-C6wpWh5U.js","./assets/SosScreen-CnF_qT1u.js","./assets/TalkMode-qN11h5CI.js","./assets/UserApp-BlDHKgFb.js","./assets/avatars-Bq_OQb0p.js","./assets/disasterAgent-CRh-N0Ji.js","./assets/glossToKorean-zV8SXV3g.js","./assets/index-CTWxoCdx.css","./assets/index-CfOzu1W6.js","./assets/myInfo-BOCHRtG-.js","./assets/nearby-DCb1yXpn.js","./assets/onnxRecognizer-DYyty2oe.js","./assets/orchestrator-8no7RMds.js","./assets/ort.wasm.bundle.min-CMShDczk.js","./assets/ortSelfTest-CzP93sOx.js","./assets/react-three-fiber.esm-BbVe4qb5.js","./assets/safetyGuides-C1af-_AE.js","./assets/useSignPlayer-Nq0bN1sM.js","./assets/useSpeechInput-CFZYhGjm.js","./assets/useSpeechOutput-AJgxt7E2.js"]

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== location.origin) return // 외부(API 등)는 건드리지 않는다

  // 문서: 최신 우선, 오프라인이면 캐시.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(VERSION).then((c) => c.put(req, copy))
          return res
        })
        .catch(() => caches.match(req).then((hit) => hit ?? caches.match('./'))),
    )
    return
  }

  // 해시가 붙은 번들: 캐시 우선(불변이다).
  if (url.pathname.includes('/assets/')) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ??
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(VERSION).then((c) => c.put(req, copy))
            }
            return res
          }),
      ),
    )
    return
  }

  // 나머지(사전·조각·모델·런타임): 캐시를 바로 돌려주고 뒤에서 갱신한다.
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const hit = await cache.match(req)
      const fresh = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone())
          return res
        })
        .catch(() => null)
      // 캐시를 돌려준 뒤에도 배경 요청이 끝까지 가도록 붙잡아 둔다.
      e.waitUntil(fresh)
      if (hit) return hit
      const res = await fresh
      // 오프라인이고 캐시에도 없으면 — 호출한 쪽이 처리한다(조각 없음 = 건너뜀).
      return res ?? Response.error()
    }),
  )
})

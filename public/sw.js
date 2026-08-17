/* SignBridge 서비스워커 — 재난 도구는 오프라인에서도 동작해야 한다.
 *
 * 재난 상황은 기지국 폭주·정전으로 네트워크가 가장 먼저 불안해지는 순간이다.
 * 한 번이라도 방문한 사용자는 그 뒤 오프라인에서도 앱 셸·아바타·동작 사전이
 * 열리도록, 지나간 응답을 캐시에 쌓는 전략을 쓴다(런타임 캐시).
 *
 * 전략
 *  - 문서(HTML): network-first — 새 배포를 우선 받고, 실패하면 캐시로.
 *  - 정적 자산(assets/models/data/ort): cache-first — 해시 파일명이라 불변이고,
 *    동작 사전 조각은 재방문 시 즉시 열리는 것이 중요하다.
 *  - 캐시 이름에 버전을 박아 배포 시 이전 캐시를 정리한다.
 */
const VERSION = 'sb-v1'
const CORE = ['./', './manifest.webmanifest', './icon-192.png', './icon-512.png']

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

  // 정적 자산: 캐시 우선, 없으면 받아서 쌓는다.
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
})

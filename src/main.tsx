import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Warm the demo's heavy assets (3D engine chunk + default avatar model) during
// idle time after first paint. Importing Avatar3D runs its module-level
// useGLTF.preload(), so the ~11MB default avatar is cached BEFORE the user
// scrolls to the demo — it then appears instantly instead of downloading on
// demand. The hero/LCP is untouched (this runs only when the main thread is idle).
const warmDemo = () => {
  import('./sections/sign/Avatar3D').catch(() => {})
}
const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void })
  .requestIdleCallback
if (ric) ric(warmDemo, { timeout: 2500 })
else setTimeout(warmDemo, 1500)

// 배포 전 점검용 — `?selftest=onnx`일 때만 돈다. 평상시 번들에 영향이 없도록 동적 import.
if (new URLSearchParams(location.search).get('selftest') === 'onnx') {
  void import('./ortSelfTest').then((m) => m.runOnnxSelfTest())
}

// 오프라인 지원 — 재난 상황은 네트워크가 가장 먼저 불안해지는 순간이다.
// 한 번 방문한 사용자는 그 뒤 오프라인에서도 앱이 열린다(sw.js 런타임 캐시).
if ('serviceWorker' in navigator && !location.hostname.includes('localhost')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      /* http 로컬 등 미지원 환경 — 조용히 넘어간다 */
    })
  })
}

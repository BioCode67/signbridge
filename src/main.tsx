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

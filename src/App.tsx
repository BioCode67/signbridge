import { lazy, Suspense, useEffect, useState } from 'react'
import { MotionConfig } from 'framer-motion'
import Navbar from './navigation/Navbar'
import Hero from './sections/Hero'
import WhySection from './sections/WhySection'
import SignAvatarDemo from './sections/SignAvatarDemo'
import QnADemo from './sections/QnADemo'
import AgentConsole from './sections/AgentConsole'
import HowItWorks from './sections/HowItWorks'
import ImpactSection from './sections/ImpactSection'
import ResultsSection from './sections/ResultsSection'
import Footer from './sections/Footer'

// 실시간 인식은 MediaPipe·TF.js 번들이 무거우므로 지연 로드(초기 페인트 보호).
const RecognitionDemo = lazy(() => import('./sections/RecognitionDemo'))

// 수어 이용자 전용 화면(#/app) — 소개 페이지와 완전히 분리된 풀스크린 도구.
const UserApp = lazy(() => import('./user/UserApp'))

function useHashRoute(): string {
  const [hash, setHash] = useState(window.location.hash)
  useEffect(() => {
    const onChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return hash
}

export default function App() {
  const hash = useHashRoute()
  if (hash.startsWith('#/app')) {
    return (
      <Suspense fallback={<div className="grid min-h-screen place-items-center bg-space-950 text-5xl">🤟</div>}>
        <UserApp />
      </Suspense>
    )
  }
  return (
    // reducedMotion="user" makes every framer-motion animation respect the
    // visitor's OS "reduce motion" setting — important for an accessibility app.
    <MotionConfig reducedMotion="user">
      <div className="relative min-h-screen overflow-x-hidden bg-space-950">
        {/* Keyboard skip link — first focusable element. */}
        <a href="#demo" className="skip-link">
          수어 데모로 건너뛰기
        </a>
        <Navbar />
        <main id="main">
          <Hero />
          <WhySection />
          <SignAvatarDemo />
          <Suspense
            fallback={
              <section id="live" className="border-t border-white/5 py-24 text-center text-sm text-slate-500">
                실시간 인식 모듈 불러오는 중…
              </section>
            }
          >
            <RecognitionDemo />
          </Suspense>
          <QnADemo />
          <AgentConsole />
          <HowItWorks />
          <ResultsSection />
          <ImpactSection />
        </main>
        <Footer />
      </div>
    </MotionConfig>
  )
}

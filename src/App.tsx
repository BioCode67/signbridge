import { lazy, Suspense } from 'react'
import { MotionConfig } from 'framer-motion'
import Navbar from './navigation/Navbar'
import Hero from './sections/Hero'
import WhySection from './sections/WhySection'
import SignAvatarDemo from './sections/SignAvatarDemo'
import QnADemo from './sections/QnADemo'

// 실시간 인식은 MediaPipe·TF.js 번들이 무거우므로 지연 로드(초기 페인트 보호).
const RecognitionDemo = lazy(() => import('./sections/RecognitionDemo'))
import HowItWorks from './sections/HowItWorks'
import ImpactSection from './sections/ImpactSection'
import Footer from './sections/Footer'

export default function App() {
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
          <HowItWorks />
          <ImpactSection />
        </main>
        <Footer />
      </div>
    </MotionConfig>
  )
}

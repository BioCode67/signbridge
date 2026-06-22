import { MotionConfig } from 'framer-motion'
import Navbar from './navigation/Navbar'
import Hero from './sections/Hero'
import WhySection from './sections/WhySection'
import SignAvatarDemo from './sections/SignAvatarDemo'
import QnADemo from './sections/QnADemo'
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
          <QnADemo />
          <HowItWorks />
          <ImpactSection />
        </main>
        <Footer />
      </div>
    </MotionConfig>
  )
}

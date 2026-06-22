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
    <div className="relative min-h-screen overflow-x-hidden bg-space-950">
      <Navbar />
      <main>
        <Hero />
        <WhySection />
        <SignAvatarDemo />
        <QnADemo />
        <HowItWorks />
        <ImpactSection />
      </main>
      <Footer />
    </div>
  )
}

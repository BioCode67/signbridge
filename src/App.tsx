import Navbar from './navigation/Navbar'
import Hero from './sections/Hero'
import SignAvatarDemo from './sections/SignAvatarDemo'
import HowItWorks from './sections/HowItWorks'
import Footer from './sections/Footer'

export default function App() {
  return (
    <div className="relative min-h-screen overflow-x-hidden bg-space-950">
      <Navbar />
      <main>
        <Hero />
        <SignAvatarDemo />
        <HowItWorks />
      </main>
      <Footer />
    </div>
  )
}

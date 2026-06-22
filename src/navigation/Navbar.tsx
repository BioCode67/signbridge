import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Button from '../ui/Button'

const LINKS = [
  { label: '왜 필요한가', href: '#why' },
  { label: '수어 데모', href: '#demo' },
  { label: '양방향 Q&A', href: '#qa' },
  { label: '작동 원리', href: '#how' },
  { label: '기대효과', href: '#impact' },
]

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState('')

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Scrollspy: highlight the nav link for the section near the viewport centre.
  useEffect(() => {
    const sections = LINKS.map((l) => document.getElementById(l.href.slice(1))).filter(
      (el): el is HTMLElement => !!el,
    )
    if (!sections.length) return
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) setActive(e.target.id)
        })
      },
      { rootMargin: '-45% 0px -50% 0px' },
    )
    sections.forEach((s) => obs.observe(s))
    return () => obs.disconnect()
  }, [])

  // Lock body scroll while the mobile menu is open
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled ? 'glass shadow-[0_8px_32px_rgba(0,0,0,0.35)]' : 'bg-transparent'
      }`}
    >
      <nav className="mx-auto flex max-w-content items-center justify-between px-6 py-4 lg:px-12">
        <a href="#top" className="flex items-center gap-2 text-lg font-bold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-cyan-glow/15 text-cyan-soft">
            ◗
          </span>
          <span className="text-white">
            Sign<span className="text-cyan-soft text-glow">Bridge</span>
          </span>
        </a>

        {/* Desktop links */}
        <div className="hidden items-center gap-8 md:flex">
          {LINKS.map((l) => {
            const isActive = active === l.href.slice(1)
            return (
              <a
                key={l.href}
                href={l.href}
                aria-current={isActive ? 'true' : undefined}
                className={`relative text-sm font-medium transition-colors hover:text-cyan-soft ${
                  isActive ? 'text-cyan-soft' : 'text-slate-300'
                }`}
              >
                {l.label}
                {isActive && (
                  <span className="absolute -bottom-1.5 left-0 right-0 mx-auto h-0.5 w-4 rounded-full bg-cyan-glow" />
                )}
              </a>
            )
          })}
          <Button href="#demo" variant="primary">
            실시간 데모
          </Button>
        </div>

        {/* Mobile hamburger */}
        <button
          type="button"
          aria-label="메뉴 열기"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex h-10 w-10 flex-col items-center justify-center gap-1.5 md:hidden"
        >
          <span
            className={`h-0.5 w-6 bg-white transition-all duration-300 ${
              open ? 'translate-y-2 rotate-45' : ''
            }`}
          />
          <span
            className={`h-0.5 w-6 bg-white transition-all duration-300 ${open ? 'opacity-0' : ''}`}
          />
          <span
            className={`h-0.5 w-6 bg-white transition-all duration-300 ${
              open ? '-translate-y-2 -rotate-45' : ''
            }`}
          />
        </button>
      </nav>

      {/* Mobile menu */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="glass overflow-hidden md:hidden"
          >
            <div className="flex flex-col gap-1 px-6 py-4">
              {LINKS.map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-3 py-3 text-base font-medium text-slate-200 transition-colors hover:bg-white/5 hover:text-cyan-soft"
                >
                  {l.label}
                </a>
              ))}
              <Button href="#demo" variant="primary" className="mt-2 w-full" onClick={() => setOpen(false)}>
                실시간 데모
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  )
}

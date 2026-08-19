import { useEffect, useState } from 'react'

export type Breakpoint = 'mobile' | 'tablet' | 'desktop'

interface ResponsiveState {
  width: number
  breakpoint: Breakpoint
  isMobile: boolean
  isTablet: boolean
  isDesktop: boolean
  /** Whether the user prefers reduced motion */
  reducedMotion: boolean
}

function getBreakpoint(width: number): Breakpoint {
  if (width < 640) return 'mobile'
  if (width < 1024) return 'tablet'
  return 'desktop'
}

const isBrowser = typeof window !== 'undefined'

/**
 * Single source of truth for layout + 3D-intensity decisions.
 * The 3D scene reads `breakpoint` / `reducedMotion` to scale down node count,
 * device pixel ratio, and bloom on weaker / smaller devices.
 */
export function useResponsive(): ResponsiveState {
  const [width, setWidth] = useState(isBrowser ? window.innerWidth : 1280)
  const [reducedMotion, setReducedMotion] = useState(false)

  useEffect(() => {
    if (!isBrowser) return

    let frame = 0
    const onResize = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setWidth(window.innerWidth))
    }
    window.addEventListener('resize', onResize)

    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onMotion = () => setReducedMotion(mq.matches)
    onMotion()
    mq.addEventListener('change', onMotion)

    return () => {
      window.removeEventListener('resize', onResize)
      mq.removeEventListener('change', onMotion)
      cancelAnimationFrame(frame)
    }
  }, [])

  const breakpoint = getBreakpoint(width)
  return {
    width,
    breakpoint,
    isMobile: breakpoint === 'mobile',
    isTablet: breakpoint === 'tablet',
    isDesktop: breakpoint === 'desktop',
    reducedMotion,
  }
}

import { Stars } from '@react-three/drei'

interface StarfieldProps {
  count?: number
  /** When false (reduced-motion), stars hold still */
  animate?: boolean
}

/**
 * Subtle deep-space starfield. Count is tuned down on weaker devices by the
 * parent scene to keep the frame budget healthy.
 */
export default function Starfield({ count = 4000, animate = true }: StarfieldProps) {
  return (
    <Stars
      radius={120}
      depth={60}
      count={count}
      factor={4}
      saturation={0}
      fade
      speed={animate ? 0.6 : 0}
    />
  )
}

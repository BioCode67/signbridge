import type { ReactNode } from 'react'

interface ButtonProps {
  children: ReactNode
  href?: string
  variant?: 'primary' | 'ghost'
  onClick?: () => void
  className?: string
}

const base =
  'inline-flex items-center justify-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold tracking-tight transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-glow/70'

const variants = {
  primary:
    'bg-cyan-glow text-space-950 shadow-[0_0_24px_rgba(34,211,238,0.35)] hover:bg-cyan-soft hover:shadow-[0_0_32px_rgba(34,211,238,0.55)] hover:-translate-y-0.5',
  ghost:
    'border border-white/15 text-slate-100 hover:border-cyan-glow/60 hover:text-cyan-soft hover:bg-white/5',
}

export default function Button({
  children,
  href,
  variant = 'primary',
  onClick,
  className = '',
}: ButtonProps) {
  const classes = `${base} ${variants[variant]} ${className}`
  if (href) {
    return (
      <a href={href} className={classes} onClick={onClick}>
        {children}
      </a>
    )
  }
  return (
    <button type="button" className={classes} onClick={onClick}>
      {children}
    </button>
  )
}

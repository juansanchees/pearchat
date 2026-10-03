import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Etiqueta (.tag do protótipo). tone: accent | neutral | outline. theme: dark (menu) ou light. */
export function Tag({
  children,
  tone = 'accent',
  theme = 'light',
  className,
}: {
  children: ReactNode
  tone?: 'accent' | 'neutral' | 'outline'
  theme?: 'dark' | 'light'
  className?: string
}) {
  const dark = theme === 'dark'
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-[6px] px-[10px] py-[3px] text-[11px] tracking-[0.02em]',
        tone === 'accent' && (dark ? 'bg-dark-accent-800 text-dark-accent-100' : 'bg-light-accent-800 text-light-accent-100'),
        tone === 'neutral' && (dark ? 'bg-dark-neutral-800 text-dark-neutral-100' : 'bg-light-neutral-800 text-light-neutral-100'),
        tone === 'outline' && 'border border-dark-accent-500 text-dark-accent-500',
        className,
      )}
    >
      {children}
    </span>
  )
}

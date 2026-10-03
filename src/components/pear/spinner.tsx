import { cn } from '@/lib/utils'

/** Spinner 30x30 do protótipo (borda accent-700, topo accent-400). */
export function Spinner({ size = 30, className }: { size?: number; className?: string }) {
  return (
    <span
      role="status"
      aria-label="Carregando"
      className={cn('inline-block animate-zfSpin rounded-pill border-2 border-light-accent-700 border-t-light-accent-400', className)}
      style={{ width: size, height: size }}
    />
  )
}

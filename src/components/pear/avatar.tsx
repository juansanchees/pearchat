import { cn } from '@/lib/utils'

/** Siglas: 1ª letra do 1º nome + 1ª letra do 2º nome (como digitadas). */
export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return (parts[0][0] ?? '') + (parts[1]?.[0] ?? '')
}

export function Avatar({
  name,
  size = 36,
  src,
  className,
}: {
  name: string
  size?: number
  src?: string | null
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-pill border border-light-accent-700 bg-light-accent-800 font-medium text-light-accent-200',
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.33)) }}
      title={name}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name} className="h-full w-full object-cover" />
      ) : (
        initials(name)
      )}
    </span>
  )
}

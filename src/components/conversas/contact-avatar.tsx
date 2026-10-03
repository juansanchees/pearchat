import type { ReactNode } from 'react'
import { initials } from './format'

// Avatar com iniciais do protótipo (fundo neutral-900, texto accent-200).
export function ContactAvatar({ name, size, badge }: { name: string; size: number; badge?: ReactNode }) {
  return (
    <span
      className="relative grid shrink-0 place-items-center rounded-pill bg-light-neutral-900 font-medium leading-none text-light-accent-200"
      style={{ width: size, height: size, fontSize: 13 }}
      aria-hidden="true"
    >
      {initials(name)}
      {badge}
    </span>
  )
}

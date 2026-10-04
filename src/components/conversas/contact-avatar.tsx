'use client'

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { initials } from './format'

/**
 * Foto do contato por cima das iniciais (as iniciais ficam por baixo: se a imagem não carregar, elas aparecem).
 * O pai precisa ser `relative` com cantos redondos; a foto nunca muda o tamanho nem a forma do avatar.
 */
export function PhotoLayer({ src }: { src?: string | null }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  if (!src || failed) return null
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} className="absolute inset-0 h-full w-full rounded-pill object-cover" />
  )
}

// Avatar com iniciais do protótipo (fundo neutral-900, texto accent-200); com foto do WhatsApp, mostra a foto.
export function ContactAvatar({ name, size, badge, photoUrl }: { name: string; size: number; badge?: ReactNode; photoUrl?: string | null }) {
  return (
    <span
      className="relative grid shrink-0 place-items-center rounded-pill bg-light-neutral-900 font-medium leading-none text-light-accent-200"
      style={{ width: size, height: size, fontSize: 13 }}
      aria-hidden="true"
    >
      {initials(name)}
      <PhotoLayer src={photoUrl} />
      {badge}
    </span>
  )
}

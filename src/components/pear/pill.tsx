'use client'
import type { ReactNode } from 'react'
import { Check, Plus } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'

/**
 * Pílula selecionável (tema claro).
 * variant "filter": filtros (5px 11px, 12px). variant "chip": múltipla escolha com ícone check/plus.
 */
export function Pill({
  active,
  onClick,
  children,
  variant = 'filter',
}: {
  active?: boolean
  onClick?: () => void
  children: ReactNode
  variant?: 'filter' | 'chip'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={!!active}
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-pill border text-[12px] transition-colors',
        variant === 'chip' ? 'gap-1.5 px-3 py-1.5' : 'px-[11px] py-[5px]',
        active
          ? 'border-light-accent-600 bg-light-accent-900 text-light-accent-200'
          : 'border-light-divider bg-transparent text-light-neutral-400 hover:border-light-neutral-700',
      )}
    >
      {variant === 'chip' && (active ? <Check size={12} weight="bold" /> : <Plus size={12} weight="bold" />)}
      {children}
    </button>
  )
}

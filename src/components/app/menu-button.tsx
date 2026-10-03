'use client'

import { List } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { useShell } from './shell-context'

/** Botão de menu da barra superior; só aparece abaixo de 900 px. */
export function MenuButton({ className }: { className?: string }) {
  const { setMenuOpen } = useShell()
  return (
    <button
      type="button"
      onClick={() => setMenuOpen(true)}
      aria-label="Abrir menu"
      className={cn(
        'grid h-8 w-8 flex-none place-items-center rounded-md border border-solid border-light-divider bg-light-surface p-0 text-light-text hover:bg-[rgba(29,33,23,.07)] min-[900px]:hidden',
        className,
      )}
    >
      <List size={16} aria-hidden="true" />
    </button>
  )
}

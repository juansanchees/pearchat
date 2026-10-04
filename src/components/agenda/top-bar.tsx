'use client'

import Link from 'next/link'
import { CalendarDots, Sparkle, WhatsappLogo } from '@phosphor-icons/react'
import { MenuButton } from '@/components/app/menu-button'
import { cn } from '@/lib/utils'

/** Barra de 56px da Agenda: ícone, título, status, switch "IA pode agendar" (sempre, com ou sem Google) e "Voltar às conversas". */
export function AgendaTopBar({
  subtitle,
  showIa,
  iaOn,
  onIa,
}: {
  subtitle: string
  showIa: boolean
  iaOn: boolean
  onIa: () => void
}) {
  return (
    <div className="flex min-h-14 flex-none flex-wrap items-center gap-x-3.5 gap-y-2 border-0 border-b border-solid border-light-divider bg-light-surface px-5 py-2 max-[899px]:px-3">
      <MenuButton />
      <span className="grid h-[30px] w-[30px] flex-none place-items-center rounded-md border border-solid border-light-accent-700 bg-light-accent-900">
        <CalendarDots size={16} className="text-light-accent-300" />
      </span>
      <div className="min-w-0">
        <h1 className="m-0 text-[14.5px] font-medium leading-[1.2] tracking-normal">Agenda</h1>
        <div className="truncate text-[11px] text-light-neutral-500">{subtitle}</div>
      </div>
      <div className="flex-1" />
      {showIa && (
        <button
          type="button"
          role="switch"
          aria-checked={iaOn}
          onClick={onIa}
          className="flex cursor-pointer items-center gap-[9px] whitespace-nowrap rounded-pill border border-solid border-light-divider bg-light-surface py-[5px] pl-3 pr-1.5 text-[12px] text-light-text"
        >
          <Sparkle size={12} weight="fill" className="text-light-accent-400" />
          IA pode agendar
          <span
            className={cn(
              'relative h-5 w-[34px] rounded-pill border border-solid transition-[background-color] duration-200',
              iaOn ? 'border-light-accent-400 bg-light-accent-500' : 'border-light-neutral-700 bg-light-neutral-900',
            )}
          >
            <span
              className={cn(
                'absolute top-[2px] h-3.5 w-3.5 rounded-pill transition-[left] [transition-duration:180ms] ease-out',
                iaOn ? 'left-4 bg-[#fbfcf3]' : 'left-[2px] bg-light-neutral-500',
              )}
            />
          </span>
        </button>
      )}
      <Link href="/whatsapp" className="pc-btn pc-btn-ghost whitespace-nowrap text-[12px] no-underline">
        <WhatsappLogo size={14} /> Voltar às conversas
      </Link>
    </div>
  )
}

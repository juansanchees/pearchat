'use client'

import Link from 'next/link'
import { ArrowClockwise, WarningCircle } from '@phosphor-icons/react'
import { MenuButton } from '@/components/app/menu-button'

// Erro inesperado numa tela do app: a barra lateral continua funcionando.
export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-light-bg text-light-text">
      <div className="flex h-12 flex-none items-center gap-3 border-0 border-b border-solid border-light-divider bg-light-surface px-3 min-[900px]:hidden">
        <MenuButton />
      </div>
      <div className="grid flex-1 place-items-center overflow-y-auto p-6">
        <div className="flex max-w-[380px] flex-col items-center gap-3 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-xl border border-solid border-light-accent-700 bg-light-accent-900 text-light-accent-300">
            <WarningCircle size={24} aria-hidden="true" />
          </span>
          <h1 className="m-0 text-[20px] font-medium leading-tight tracking-[-0.01em]">Algo deu errado</h1>
          <p className="m-0 text-[13px] leading-relaxed text-light-neutral-500">
            Não foi possível abrir esta tela. Tente de novo; se continuar, volte para as conversas.
          </p>
          <div className="mt-1 flex flex-wrap justify-center gap-2">
            <button type="button" onClick={reset} className="pc-btn pc-btn-primary">
              <ArrowClockwise size={14} aria-hidden="true" /> Tentar de novo
            </button>
            <Link href="/whatsapp" className="pc-btn pc-btn-secondary no-underline">
              Ir para as conversas
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowClockwise, WarningCircle } from '@phosphor-icons/react'

// Erro numa tela (inclusive o do layout do app): o mais comum é o banco sem resposta por um instante. A sessão NÃO é apagada
// e ninguém é levado ao login: é só tentar de novo. Mesmo visual de (app)/error.tsx, sem a barra lateral.
export default function RootError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <div className="grid min-h-screen place-items-center bg-light-bg p-6 text-light-text">
      <div className="flex max-w-[380px] flex-col items-center gap-3 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-xl border border-solid border-light-accent-700 bg-light-accent-900 text-light-accent-300">
          <WarningCircle size={24} aria-hidden="true" />
        </span>
        <h1 className="m-0 text-[20px] font-medium leading-tight tracking-[-0.01em]">Não foi possível carregar agora</h1>
        <p className="m-0 text-[13px] leading-relaxed text-light-neutral-500">
          O serviço está instável por um instante. Sua sessão continua ativa: tente de novo em alguns segundos.
        </p>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(() => {
              router.refresh() // erro de servidor: busca a tela de novo
              reset()
            })
          }
          className="pc-btn pc-btn-primary mt-1"
        >
          <ArrowClockwise size={14} aria-hidden="true" /> {pending ? 'Tentando…' : 'Tentar de novo'}
        </button>
      </div>
    </div>
  )
}

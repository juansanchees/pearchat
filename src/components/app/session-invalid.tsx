'use client'

import { useState } from 'react'
import { signOut } from 'next-auth/react'
import { WarningCircle } from '@phosphor-icons/react'

// Sessão válida no cookie, mas a conta não existe mais (excluída, banco restaurado): em vez de quebrar a tela, pede para entrar de novo.
export function SessionInvalid() {
  const [busy, setBusy] = useState(false)
  return (
    <div className="grid min-h-screen place-items-center bg-light-bg p-6 text-light-text">
      <div className="flex max-w-[380px] flex-col items-center gap-3 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-xl border border-solid border-light-accent-700 bg-light-accent-900 text-light-accent-300">
          <WarningCircle size={24} aria-hidden="true" />
        </span>
        <h1 className="m-0 text-[20px] font-medium leading-tight">Sua sessão não é mais válida</h1>
        <p className="m-0 text-[13px] leading-relaxed text-light-neutral-500">Entre de novo para continuar usando o PearChat.</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void signOut({ callbackUrl: '/login' })
          }}
          className="pc-btn pc-btn-primary mt-1"
        >
          {busy ? 'Saindo…' : 'Entrar de novo'}
        </button>
      </div>
    </div>
  )
}

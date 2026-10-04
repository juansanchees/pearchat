import type { Metadata } from 'next'
import { CalendarX } from '@phosphor-icons/react/dist/ssr'

export const metadata: Metadata = { title: 'Link indisponível', robots: { index: false, follow: false } }

// Mesma tela para link inexistente, desativado ou de negócio arquivado (não revela quais negócios existem).
export default function LinkIndisponivel() {
  return (
    <main className="grid min-h-screen place-items-center bg-light-bg p-6 text-light-text [color-scheme:light]">
      <div className="flex max-w-[380px] flex-col items-center gap-3 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-xl border border-solid border-light-accent-700 bg-light-accent-900 text-light-accent-300">
          <CalendarX size={24} aria-hidden="true" />
        </span>
        <h1 className="m-0 text-[22px] font-medium leading-tight tracking-[-0.01em]">Este link não está disponível</h1>
        <p className="m-0 text-[13px] leading-relaxed text-light-neutral-500">
          O endereço de agendamento que você abriu não existe ou foi desativado. Fale diretamente com o negócio para marcar seu horário.
        </p>
      </div>
    </main>
  )
}

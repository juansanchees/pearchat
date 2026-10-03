import Link from 'next/link'
import type { Metadata } from 'next'
import { Compass } from '@phosphor-icons/react/dist/ssr'

export const metadata: Metadata = { title: 'PearChat · Página não encontrada' }

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-light-bg p-6 text-light-text [color-scheme:light]">
      <div className="flex max-w-[380px] flex-col items-center gap-3 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-xl border border-solid border-light-accent-700 bg-light-accent-900 text-light-accent-300">
          <Compass size={24} aria-hidden="true" />
        </span>
        <h1 className="m-0 text-[22px] font-medium leading-tight tracking-[-0.01em]">Página não encontrada</h1>
        <p className="m-0 text-[13px] leading-relaxed text-light-neutral-500">
          O endereço que você abriu não existe ou foi movido. Volte para as conversas e continue de onde parou.
        </p>
        <Link href="/whatsapp" className="pc-btn pc-btn-primary mt-1 no-underline">
          Ir para as conversas
        </Link>
      </div>
    </main>
  )
}

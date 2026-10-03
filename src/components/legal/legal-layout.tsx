import type { ReactNode } from 'react'
import Link from 'next/link'
import { LogoMark, Wordmark } from '@/components/auth/auth-shell'

export const EMPRESA = {
  razao: 'INFODREAMZ NEGOCIOS DIGITAIS LTDA',
  cnpj: '40.741.391/0001-10',
  endereco: 'Rua Castelo Branco, 255, Centro, Benevides/PA, CEP 68795-000',
  email: 'j.dslsanches@gmail.com',
  foro: 'Comarca de Benevides, Estado do Pará',
}
export const ULTIMA_ATUALIZACAO = '3 de outubro de 2026'

export type LegalSection = { id: string; titulo: string; corpo: ReactNode }

export function P({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-[15px] leading-[1.7] text-light-neutral-300">{children}</p>
}
export function UL({ children }: { children: ReactNode }) {
  return <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[15px] leading-[1.65] text-light-neutral-300">{children}</ul>
}
export function A({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-light-accent-200 underline underline-offset-2 hover:text-light-accent-300">
      {children}
    </a>
  )
}
export function Mail() {
  return (
    <a href={`mailto:${EMPRESA.email}`} className="text-light-accent-200 underline underline-offset-2 hover:text-light-accent-300">
      {EMPRESA.email}
    </a>
  )
}

export function LegalLayout({ titulo, intro, secoes, outra }: { titulo: string; intro: string; secoes: LegalSection[]; outra: { href: string; label: string } }) {
  return (
    <div className="min-h-screen bg-light-bg text-[14px] text-light-text print:bg-white">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-10 focus:rounded-md focus:bg-light-surface focus:px-3 focus:py-2">
        Ir para o conteúdo
      </a>
      <header className="border-b border-light-divider bg-light-surface print:hidden">
        <div className="mx-auto flex max-w-[960px] items-center justify-between px-6 py-4">
          <Link href="/login" className="flex items-center gap-[9px] rounded-md" aria-label="PearChat">
            <LogoMark />
            <Wordmark />
          </Link>
          <nav aria-label="Documentos" className="flex items-center gap-5 text-[13px]">
            <Link href={outra.href} className="text-light-neutral-500 hover:text-light-neutral-300">{outra.label}</Link>
            <Link href="/login" className="font-medium text-light-accent-200 hover:text-light-accent-300">Entrar</Link>
          </nav>
        </div>
      </header>

      <main id="conteudo" className="mx-auto max-w-[720px] px-6 pb-16 pt-12">
        <h1 className="text-[32px] font-medium leading-[1.15] tracking-[-0.02em]">{titulo}</h1>
        <p className="mt-2 text-[13px] text-light-neutral-500">Última atualização: {ULTIMA_ATUALIZACAO}</p>
        <p className="mt-5 text-[15px] leading-[1.7] text-light-neutral-300">{intro}</p>

        <nav aria-label="Sumário" className="mt-8 rounded-lg border border-light-divider bg-light-surface p-5 print:border-0 print:p-0">
          <h2 className="text-[13px] font-medium uppercase tracking-[.12em] text-light-neutral-500">Sumário</h2>
          <ol className="mt-3 columns-1 gap-8 text-[14px] leading-[1.9] sm:columns-2">
            {secoes.map((s, i) => (
              <li key={s.id} className="break-inside-avoid">
                <a href={`#${s.id}`} className="text-light-accent-200 hover:underline">{i + 1}. {s.titulo}</a>
              </li>
            ))}
          </ol>
        </nav>

        {secoes.map((s, i) => (
          <section key={s.id} id={s.id} aria-labelledby={`${s.id}-t`} className="mt-10 scroll-mt-6">
            <h2 id={`${s.id}-t`} className="text-[20px] font-medium leading-tight tracking-[-0.01em]">{i + 1}. {s.titulo}</h2>
            {s.corpo}
          </section>
        ))}
      </main>

      <footer className="border-t border-light-divider bg-light-surface">
        <div className="mx-auto max-w-[720px] px-6 py-8 text-[12.5px] leading-[1.7] text-light-neutral-500">
          <div className="font-medium text-light-neutral-300">{EMPRESA.razao}</div>
          <div>CNPJ {EMPRESA.cnpj}</div>
          <div>{EMPRESA.endereco}</div>
          <div>Contato: <Mail /></div>
          <div className="mt-3">© 2026 PearChat · Última atualização: {ULTIMA_ATUALIZACAO}</div>
        </div>
      </footer>
    </div>
  )
}

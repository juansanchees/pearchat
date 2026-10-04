import Link from 'next/link'
import { EMPRESA } from '@/components/legal/legal-layout'
import { LogoLink, NAV } from './site-header'
import { wrap } from './ui/styles'

// Rodapé escuro, continuando a chamada final. Mantém todo o conteúdo legal (razão social, CNPJ, endereço,
// Termos, Privacidade e contato).
const linkCls =
  'inline-flex min-h-[32px] items-center rounded-sm text-[14px] text-dark-neutral-400 underline-offset-2 transition-colors hover:text-white hover:underline'

export function SiteFooter() {
  return (
    <footer className="border-t border-white/[.06] bg-[#0a1a10] pb-10 pt-16 text-dark-text">
      <div className={`${wrap} grid grid-cols-1 gap-12 min-[768px]:grid-cols-[minmax(0,5fr)_minmax(0,3fr)_minmax(0,3fr)]`}>
        <div className="max-w-[420px]">
          <LogoLink dark />
          <p className="mt-4 text-[13px] leading-[1.7] text-dark-neutral-400">
            {EMPRESA.razao}
            <br />
            CNPJ {EMPRESA.cnpj}
            <br />
            {EMPRESA.endereco}
          </p>
        </div>
        <nav aria-label="Página inicial" className="flex flex-col gap-1">
          <p className="mb-2 text-[12px] font-medium uppercase tracking-[.12em] text-dark-neutral-500">PearChat</p>
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className={linkCls}>
              {n.label}
            </a>
          ))}
        </nav>
        <nav aria-label="Conta e documentos" className="flex flex-col gap-1">
          <p className="mb-2 text-[12px] font-medium uppercase tracking-[.12em] text-dark-neutral-500">Conta e documentos</p>
          <Link href="/registro" className={linkCls}>
            Criar conta
          </Link>
          <Link href="/login" className={linkCls}>
            Entrar
          </Link>
          <Link href="/termos" className={linkCls}>
            Termos de uso
          </Link>
          <Link href="/privacidade" className={linkCls}>
            Política de privacidade
          </Link>
          <a href={`mailto:${EMPRESA.email}`} className={`${linkCls} break-all`}>
            {EMPRESA.email}
          </a>
        </nav>
      </div>
      <div className={`${wrap} mt-14`}>
        <p className="border-t border-white/[.08] pt-6 text-[12.5px] text-dark-neutral-500">© {new Date().getFullYear()} PearChat</p>
      </div>
    </footer>
  )
}

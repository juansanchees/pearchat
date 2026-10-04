import Link from 'next/link'
import { List, X } from '@phosphor-icons/react/dist/ssr'
import { Logo } from '@/components/brand/logo'
import { btnSmall } from './ui/styles'

export const NAV = [
  { href: '#funcionalidades', label: 'Funcionalidades' },
  { href: '#como-funciona', label: 'Como funciona' },
  { href: '#para-quem-e', label: 'Para quem é' },
  { href: '#planos', label: 'Planos' },
  { href: '#duvidas', label: 'Dúvidas' },
]

export function LogoLink({ dark = false, height = 34 }: { dark?: boolean; height?: number }) {
  return (
    <Link href="/" className="-ml-1 flex flex-none items-center rounded-md" aria-label="PearChat, página inicial">
      <Logo theme={dark ? 'dark' : 'light'} height={height} priority />
    </Link>
  )
}

/** Barra fixa e discreta. No celular, as âncoras ficam num menu <details> (funciona sem JavaScript). */
export function SiteHeader() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-[rgba(29,33,23,.06)] bg-[rgba(246,247,239,.78)] backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex h-16 w-full max-w-[1240px] items-center gap-8 px-5 min-[768px]:px-8">
        <LogoLink />
        <nav aria-label="Seções" className="hidden items-center gap-7 text-[14px] text-light-neutral-400 min-[1024px]:flex">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className="rounded-sm transition-colors hover:text-light-text">
              {n.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1.5 min-[480px]:gap-3">
          <Link href="/login" className="inline-flex min-h-[44px] items-center rounded-md px-2.5 text-[14px] font-medium text-light-neutral-300 transition-colors hover:text-light-text">
            Entrar
          </Link>
          <Link href="/registro" className={`${btnSmall} min-h-[44px]`}>
            Começar grátis
          </Link>
          <details className="group relative min-[1024px]:hidden">
            <summary
              className="grid h-11 w-11 cursor-pointer list-none place-items-center rounded-md text-light-text hover:bg-[rgba(29,33,23,.06)] [&::-webkit-details-marker]:hidden"
              aria-label="Abrir menu de seções"
            >
              <List size={20} className="group-open:hidden" aria-hidden="true" />
              <X size={20} className="hidden group-open:block" aria-hidden="true" />
            </summary>
            <nav
              aria-label="Seções"
              className="absolute right-0 top-[calc(100%+10px)] flex w-[220px] flex-col rounded-[14px] border border-light-divider bg-white p-2 shadow-[0_24px_50px_-20px_rgba(29,33,23,.35)]"
            >
              {NAV.map((n) => (
                <a key={n.href} href={n.href} className="flex min-h-[44px] items-center rounded-md px-3 text-[15px] text-light-neutral-300 hover:bg-light-bg hover:text-light-text">
                  {n.label}
                </a>
              ))}
            </nav>
          </details>
        </div>
      </div>
    </header>
  )
}

import type { ReactNode } from 'react'
import Link from 'next/link'
import { CalendarDots, LockSimple, PaperPlaneTilt, Sparkle } from '@phosphor-icons/react/dist/ssr'
import { Logo } from '@/components/brand/logo'

export function Brand({ dark = false }: { dark?: boolean }) {
  return (
    <Link href="/" className="-ml-1 flex items-center rounded-md" aria-label="PearChat — página inicial">
      <Logo theme={dark ? 'dark' : 'light'} height={dark ? 44 : 40} priority />
    </Link>
  )
}

const FEATURES = [
  { Icon: Sparkle, texto: 'Agente de IA que responde do seu jeito' },
  { Icon: PaperPlaneTilt, texto: 'Disparos e follow-up automáticos' },
  { Icon: CalendarDots, texto: 'Agendamentos direto no Google Agenda' },
]

function BrandPanel() {
  return (
    <aside
      className="relative hidden max-w-[600px] min-w-0 flex-[1_1_380px] flex-col gap-9 overflow-hidden bg-dark-bg px-10 py-8 text-dark-text min-[800px]:flex"
      style={{
        background:
          'radial-gradient(700px 420px at 10% 0%, #173322, transparent 70%), radial-gradient(600px 400px at 100% 100%, #12251a, transparent 70%), #14170f',
      }}
    >
      <Brand dark />

      <div className="flex flex-1 flex-col justify-center gap-7">
        <div>
          <h2 className="max-w-[15ch] text-balance text-[34px] font-medium leading-[1.12] tracking-[-0.025em]">
            Seu WhatsApp trabalhando por você.
          </h2>
          <p className="mt-3.5 max-w-[40ch] text-sm leading-[1.55] text-dark-neutral-400 [text-wrap:pretty]">
            Conecte o número, ligue a IA e acompanhe atendimento, disparos e agenda em uma tela só.
          </p>
        </div>

        <div
          aria-hidden="true"
          className="flex max-w-[380px] animate-pcInSlow flex-col gap-2.5 rounded-lg border border-dark-divider bg-[color-mix(in_srgb,#1d2117_86%,transparent)] p-4 shadow-[0_24px_60px_rgba(0,0,0,.35)]"
        >
          <div className="flex items-center gap-2.5 border-b border-dark-divider pb-2.5">
            <span className="grid h-[30px] w-[30px] place-items-center rounded-full bg-dark-neutral-900 text-[11px] font-medium leading-none text-dark-accent-200">
              JF
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-medium leading-[1.2]">Juliana Freitas</div>
              <div className="text-[10.5px] text-dark-neutral-500">online</div>
            </div>
            <span className="flex items-center gap-[5px] rounded-full border border-dark-accent-700 bg-dark-accent-900 px-2 py-[3px] text-[10.5px] text-dark-accent-200">
              <Sparkle size={10} weight="fill" />
              IA ativa
            </span>
          </div>
          <div className="max-w-[80%] self-start rounded-[12px_12px_12px_4px] bg-dark-neutral-900 px-[11px] py-2 text-[12.5px] leading-[1.4]">
            Vocês entregam no Tatuapé?
          </div>
          <div className="max-w-[86%] self-end rounded-[12px_12px_4px_12px] border border-dark-accent-700 bg-dark-accent-900 px-[11px] py-2 text-[12.5px] leading-[1.4]">
            <div className="mb-[5px] flex items-center gap-1 text-[10px] font-medium leading-none text-dark-accent-300">
              <Sparkle size={9} weight="fill" />
              Luna · IA
            </div>
            Entregamos sim! A taxa é R$ 12. Para qual dia você precisa?
          </div>
          <div className="self-end text-[10.5px] text-dark-neutral-500">respondido em 3 s</div>
        </div>

        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {FEATURES.map(({ Icon, texto }) => (
            <li key={texto} className="flex items-center gap-3">
              <span className="grid h-[30px] w-[30px] flex-none place-items-center rounded-lg border border-dark-accent-700 bg-dark-accent-900">
                <Icon size={15} className="text-dark-accent-300" aria-hidden="true" />
              </span>
              <span className="text-[13px] text-dark-neutral-300">{texto}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex gap-4 text-[11.5px] text-dark-neutral-500">
        <span>© 2026 PearChat</span>
        <a href="/termos" target="_blank" rel="noopener noreferrer" className="text-dark-neutral-400 hover:text-dark-neutral-200">Termos</a>
        <a href="/privacidade" target="_blank" rel="noopener noreferrer" className="text-dark-neutral-400 hover:text-dark-neutral-200">Privacidade</a>
      </div>
    </aside>
  )
}

// Estrutura das telas de acesso: painel da marca (escuro) + formulário (claro).
export function AuthShell({
  topText,
  topLabel,
  topHref,
  children,
}: {
  topText?: string
  topLabel?: string
  topHref?: string
  children: ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-wrap bg-light-bg text-[13.5px] text-light-text">
      <BrandPanel />
      <main className="flex min-w-0 flex-[1.4_1_420px] flex-col px-5 py-7 min-[800px]:px-8">
        <div className="flex min-h-8 items-center justify-between gap-3">
          <div className="min-[800px]:hidden">
            <Brand />
          </div>
          <div className="flex-1" />
          {topLabel && topHref && (
            <div className="flex items-center gap-1.5 whitespace-nowrap text-[12.5px] text-light-neutral-500">
              <span className="max-[479px]:hidden">{topText}</span>
              <Link href={topHref} className="rounded-sm font-medium leading-none text-light-accent-200 hover:text-light-accent-100">
                {topLabel}
              </Link>
            </div>
          )}
        </div>

        <div className="grid flex-1 place-items-center py-7">
          <div className="w-full max-w-[400px]">{children}</div>
        </div>

        <div className="flex justify-center gap-1.5 text-[11.5px] text-light-neutral-500">
          <LockSimple size={13} aria-hidden="true" />
          Conexão segura · seus dados ficam na nuvem da sua empresa
        </div>
      </main>
    </div>
  )
}

export function AuthTitle({ children, sub, size = 28 }: { children: string; sub?: ReactNode; size?: 26 | 28 }) {
  return (
    <div>
      <h1 className={`font-medium leading-[1.15] tracking-[-0.02em] ${size === 26 ? 'text-[26px]' : 'text-[28px]'}`}>{children}</h1>
      {sub && <div className="mt-[7px] text-[13.5px] leading-normal text-light-neutral-500 [text-wrap:pretty]">{sub}</div>}
    </div>
  )
}

export function IconBadge({ children }: { children: ReactNode }) {
  return (
    <span className="grid h-[52px] w-[52px] place-items-center rounded-[14px] border border-light-accent-700 bg-light-accent-900 text-light-accent-300">
      {children}
    </span>
  )
}

import Link from 'next/link'
import { Check } from '@phosphor-icons/react/dist/ssr'
import { PLAN_KEYS, PLANS, planPrice, type PlanKey } from '@/lib/plans'
import { cn } from '@/lib/utils'
import { PricingNotice } from '../pricing-notice'
import { btnPro, btnSecondary, eyebrow, h2, wrap } from '../ui/styles'

// Nomes, preços e limites vêm de src/lib/plans.ts (fonte única). Nada aqui é digitado à mão.

const fmt = (n: number) => n.toLocaleString('pt-BR')
const preco = (n: number) => (Number.isInteger(n) ? fmt(n) : n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))

function linhas(key: PlanKey): string[] {
  const p = PLANS[key]
  return [
    p.espacos === 1 ? '1 WhatsApp' : `${p.espacos} WhatsApps`,
    p.pessoas === 1 ? '1 pessoa na equipe' : `Até ${p.pessoas} pessoas na equipe`,
    p.respostasIa === null ? 'Respostas da IA ilimitadas' : `${fmt(p.respostasIa)} respostas da IA por mês`,
    p.disparos === null ? 'Disparos ilimitados' : `${fmt(p.disparos)} disparos por mês`,
    p.contatos === null ? 'Contatos ilimitados' : `Até ${fmt(p.contatos)} contatos`,
  ]
}

const PARA: Record<PlanKey, string> = {
  ESSENCIAL: 'Para começar com um número.',
  PRO: 'Para quem atende com equipe.',
  NEGOCIOS: 'Para operações com mais números.',
}

export function Pricing() {
  return (
    <section id="planos" aria-labelledby="t-planos" className="bg-light-bg py-24 min-[768px]:py-36">
      <div className={wrap}>
        <div className="mx-auto max-w-[760px] text-center">
          <p className={cn(eyebrow, 'text-light-accent-300')}>Planos</p>
          <h2 id="t-planos" className={cn(h2, 'mt-5')}>
            Escolha pelo número de WhatsApps.
          </h2>
          <p className="mx-auto mt-5 max-w-[52ch] text-[17px] leading-[1.6] text-light-neutral-400">
            Todos os planos têm agente de IA, agenda, link de agendamento, follow-up, disparos e contatos.
          </p>
        </div>

        <ul className="m-0 mx-auto mt-14 grid grid-cols-1 max-w-[1120px] list-none grid-cols-1 gap-5 p-0 min-[900px]:grid-cols-3 min-[900px]:items-stretch">
          {PLAN_KEYS.map((key) => {
            const p = PLANS[key]
            const destaque = key === 'PRO'
            return (
              <li
                key={key}
                className={cn(
                  'relative flex flex-col rounded-[22px] p-7 transition-[transform,box-shadow] duration-300 hover:-translate-y-1 focus-within:-translate-y-1 motion-reduce:hover:translate-y-0 min-[1100px]:p-8',
                  destaque
                    ? 'bg-[#0d1410] text-dark-text shadow-[0_40px_80px_-30px_rgba(13,20,16,.7),0_0_0_1px_rgba(92,203,110,.35)] hover:shadow-[0_48px_90px_-30px_rgba(13,20,16,.75),0_0_0_1px_rgba(92,203,110,.55)]'
                    : 'border border-light-divider bg-white shadow-[0_1px_2px_rgba(29,33,23,.04)] hover:shadow-[0_24px_50px_-24px_rgba(29,33,23,.25)]',
                )}
                style={destaque ? { backgroundImage: 'radial-gradient(90% 60% at 100% 0%, rgba(46,154,72,.28), transparent 70%)' } : undefined}
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-[19px] font-semibold tracking-[-0.01em]">{p.nome}</h3>
                  {destaque && <span className="rounded-pill bg-dark-accent-500 px-2.5 py-1 text-[11px] font-medium text-[#06200f]">Recomendado</span>}
                </div>
                <p className={cn('mt-1.5 text-[14px]', destaque ? 'text-dark-neutral-400' : 'text-light-neutral-500')}>{PARA[key]}</p>
                <p className="mt-7 flex items-baseline gap-1.5">
                  <span className={cn('text-[16px] font-medium', destaque ? 'text-dark-neutral-300' : 'text-light-neutral-400')}>R$</span>
                  <span className="text-[52px] font-semibold leading-none tracking-[-0.04em]">{preco(planPrice(key))}</span>
                  <span className={cn('text-[14px]', destaque ? 'text-dark-neutral-400' : 'text-light-neutral-500')}>/mês</span>
                </p>
                <ul className={cn('mt-7 flex list-none flex-col gap-3 border-t p-0 pt-7', destaque ? 'border-white/10' : 'border-light-divider')}>
                  {linhas(key).map((l) => (
                    <li key={l} className={cn('flex items-start gap-2.5 text-[14.5px] leading-[1.45]', destaque ? 'text-dark-neutral-200' : 'text-light-neutral-300')}>
                      <Check size={16} weight="bold" className={cn('mt-[2px] flex-none', destaque ? 'text-dark-accent-400' : 'text-light-accent-400')} aria-hidden="true" />
                      {l}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/registro"
                  className={cn('mt-8 w-full', destaque ? btnPro : btnSecondary)}
                >
                  Começar grátis
                </Link>
              </li>
            )
          })}
        </ul>
        <PricingNotice />
      </div>
    </section>
  )
}

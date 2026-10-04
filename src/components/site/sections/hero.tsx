import Link from 'next/link'
import { ArrowRight, WhatsappLogo } from '@/components/site/ui/icons'
import { btnPrimary, btnSecondary, wrap } from '../ui/styles'
import { HeroStage } from './hero-stage'

// Herói: o texto é renderizado no servidor e aparece de imediato (é o LCP). O palco em perspectiva é uma ilha
// cliente (hero-stage.tsx): cena fixa de 1200 × 660 px que escala por breakpoint (--lp-s em globals.css);
// abaixo de 768 px vira uma janela só, com a mesma história rodando.
export function Hero() {
  return (
    <section aria-labelledby="titulo-principal" className="relative overflow-hidden bg-light-bg pt-28 min-[768px]:pt-36">
      {/* Luz suave atrás do palco */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[1200px]"
        style={{
          background:
            'radial-gradient(55% 40% at 50% 68%, rgba(122,204,74,.18), transparent 70%), radial-gradient(40% 30% at 50% 0%, rgba(255,255,255,.9), transparent 70%)',
        }}
      />
      <div className={`${wrap} relative text-center`}>
        <p className="inline-flex items-center gap-2 rounded-pill border border-[rgba(29,33,23,.1)] bg-white/70 px-3.5 py-1.5 text-[12.5px] text-light-neutral-400 backdrop-blur">
          <WhatsappLogo size={15} weight="fill" className="text-light-accent-400" aria-hidden="true" />
          Para negócios que atendem pelo WhatsApp
        </p>
        <h1
          id="titulo-principal"
          className="mx-auto mt-6 text-balance text-[44px] font-semibold leading-[0.98] tracking-[-0.045em] min-[768px]:text-[64px] min-[1024px]:text-[80px] min-[1200px]:text-[92px]"
        >
          Seu WhatsApp <br className="max-[480px]:hidden" />
          trabalhando <span className="text-light-accent-400">por você.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-[60ch] text-[17px] leading-[1.6] text-light-neutral-400 [text-wrap:pretty] min-[768px]:text-[19px]">
          O PearChat atende seus clientes, agenda horários, faz follow-ups e mantém suas conversas organizadas usando inteligência artificial.
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Link href="/registro" className={btnPrimary}>
            Começar grátis <ArrowRight size={16} weight="bold" aria-hidden="true" />
          </Link>
          <a href="#funcionalidades" className={btnSecondary}>
            Conhecer o PearChat
          </a>
        </div>
        <p className="mt-4 text-[13px] text-light-neutral-400">Sem cartão de crédito. Durante o lançamento, o uso é gratuito.</p>
      </div>

      <div className="relative mt-14 pb-20 min-[768px]:mt-16 min-[768px]:pb-24">
        <p className="sr-only">
          Ilustração: um cliente pergunta se há horário amanhã, a IA do PearChat oferece 14h e 16h, pede confirmação e cria o
          agendamento, que aparece na Agenda.
        </p>
        <div className={wrap}>
          <HeroStage />
        </div>
      </div>
    </section>
  )
}

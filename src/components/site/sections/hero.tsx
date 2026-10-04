import Link from 'next/link'
import { ArrowRight, CalendarCheck, WhatsappLogo } from '@phosphor-icons/react/dist/ssr'
import { PearGlass } from '@/components/brand/pear-glass'
import { HERO_FINAL, HeroAgenda, HeroAgent, HeroChat, HeroContacts } from '../mini/hero-windows'
import { btnPrimary, btnSecondary, wrap } from '../ui/styles'

/** Aviso "Novo agendamento" que flutua à frente do palco (mesmo texto da notificação do app). */
function NewBookingToast({ className }: { className?: string }) {
  return (
    <div className={`flex items-center gap-3 rounded-[12px] border border-light-divider bg-white/95 px-3.5 py-3 shadow-[0_18px_40px_-14px_rgba(29,33,23,.35)] backdrop-blur ${className ?? ''}`}>
      <span className="grid h-9 w-9 flex-none place-items-center rounded-[10px] bg-light-accent-fill text-white">
        <CalendarCheck size={18} weight="bold" />
      </span>
      <span className="min-w-0">
        <span className="block text-[12.5px] font-medium leading-tight">Novo agendamento</span>
        <span className="mt-0.5 block truncate text-[11.5px] text-light-neutral-500">Rafael Costa · amanhã, 16:00</span>
      </span>
    </div>
  )
}

/**
 * Palco em perspectiva: a conversa em primeiro plano e, em profundidade, Agenda, Contatos e Agente de IA.
 * Cada camada é absoluta numa cena fixa de 1180 × 620 px; a cena inteira escala por breakpoint (--lp-s em globals.css).
 * Abaixo de 768 px vira uma composição simples empilhada.
 */
function Stage({ step = HERO_FINAL }: { step?: number }) {
  const created = step >= HERO_FINAL
  return (
    <>
      <div className="lp-stage relative mx-auto hidden min-[768px]:block" aria-hidden="true">
        <div className="lp-scale">
          <div className="lp-scene">
            <div className="lp-layer" style={{ left: 850, top: -10, width: 330, transform: 'translateZ(-480px) rotateY(16deg)', filter: 'blur(1.4px)', opacity: 0.75 }}>
              <HeroContacts />
            </div>
            <div className="lp-layer" style={{ left: -10, top: 20, width: 340, transform: 'translateZ(-300px) rotateY(-16deg)', filter: 'blur(0.8px)', opacity: 0.88 }}>
              <HeroAgent />
            </div>
            <div className="lp-layer" style={{ left: 770, top: 120, width: 410, transform: 'translateZ(-150px) rotateY(14deg)' }}>
              <HeroAgenda created={created} />
            </div>
            <div className="lp-layer" style={{ left: 150, top: 44, width: 730, transform: 'translateZ(0)' }}>
              <HeroChat step={step} />
            </div>
            {created && (
              <div className="lp-layer" style={{ left: 856, top: 478, width: 280, transform: 'translateZ(150px)' }}>
                <NewBookingToast />
              </div>
            )}
            <div className="lp-layer" style={{ left: 78, top: 372, width: 140, transform: 'translateZ(190px) rotate(-8deg)' }}>
              <PearGlass id="pg-hero" className="w-full" />
            </div>
          </div>
        </div>
      </div>

      {/* Celular: composição simples */}
      <div className="relative mx-auto mt-2 max-w-[520px] min-[768px]:hidden" aria-hidden="true">
        <HeroChat step={step} compact />
        {created && <NewBookingToast className="relative -mt-6 ml-auto mr-3 w-[min(270px,85%)]" />}
        <PearGlass id="pg-hero-m" className="absolute -right-2 -top-12 w-[64px]" />
      </div>
    </>
  )
}

export function Hero() {
  return (
    <section aria-labelledby="titulo-principal" className="relative overflow-hidden bg-light-bg pt-28 min-[768px]:pt-36">
      {/* Luz suave atrás do palco */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[1100px]"
        style={{
          background:
            'radial-gradient(60% 45% at 50% 62%, rgba(122,204,74,.16), transparent 70%), radial-gradient(40% 30% at 50% 0%, rgba(255,255,255,.9), transparent 70%)',
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
        <p className="mt-4 text-[13px] text-light-neutral-500">Sem cartão de crédito. Durante o lançamento, o uso é gratuito.</p>
      </div>

      <div className="relative mt-14 pb-16 min-[768px]:mt-16 min-[768px]:pb-0">
        <p className="sr-only">
          Ilustração: um cliente pergunta se há horário amanhã, a IA do PearChat oferece 14h e 16h, pede confirmação e cria o
          agendamento, que aparece na Agenda.
        </p>
        <div className={wrap}>
          <Stage />
        </div>
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 hidden h-40 bg-gradient-to-b from-transparent to-light-bg min-[768px]:block" />
      </div>
    </section>
  )
}

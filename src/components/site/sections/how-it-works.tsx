'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { useStepper } from '../anim/use-play'
import { AutomationsPanel, ConnectPanel, TEACH_ITEMS, TeachPanel, WorkingPanel, type ConnectState } from '../mini/how-panels'
import { eyebrow, wrap } from '../ui/styles'

// "Como funciona": em telas largas E altas (largura ≥ 1024 e altura ≥ 700, variante arbitrária do Tailwind) a interface fica presa
// e o texto rola; a etapa no meio da tela (IntersectionObserver) decide o painel, e cada painel roda a sua coreografia
// ao ficar ativo. Em telas menores ou baixas, cada etapa mostra o seu painel logo abaixo do texto e anima ao aparecer.

const STEPS = [
  {
    titulo: 'Conecte seu WhatsApp',
    texto: 'Escaneie o QR Code com o celular, como no WhatsApp Web. Você continua usando o seu número de sempre.',
    alt: 'Tela de conexão com o QR Code e as instruções para escanear.',
  },
  {
    titulo: 'Ensine sua IA',
    texto: 'Escreva o que um bom atendente do seu negócio precisa saber: horários, serviços, preços, endereço e as perguntas que mais chegam.',
    alt: 'Instruções do agente e a lista do que ele precisa saber: horários, serviços, preços, endereço e perguntas frequentes.',
  },
  {
    titulo: 'Ligue as automações',
    texto: 'IA, follow-up e lembretes da agenda: ligue o que fizer sentido. Dá para desligar qualquer um quando quiser.',
    alt: 'Automações ligadas: agentes de IA, follow-up automático e lembretes da agenda.',
  },
  {
    titulo: 'Deixe o PearChat trabalhar',
    texto: 'As conversas chegam, a IA responde, os horários vão para a agenda e quem sumiu recebe um follow-up. Você acompanha tudo e entra quando quiser.',
    alt: 'Conversas chegando, várias respondidas pela IA, um agendamento criado e um follow-up enviado.',
  },
]

// Coreografia de cada painel (ms por passo; o último fica parado até o painel sair).
const CHOREO = [
  [1400, 1000, 60000], // QR: aguardando → conectando → conectado
  [500, ...TEACH_ITEMS.slice(1).map(() => 450), 60000], // campos preenchendo (0 a 5)
  [600, 550, 550, 60000], // interruptores ligando
  [500, 700, 700, 700, 700, 60000], // conversas chegando
]
const CONNECT: ConnectState[] = ['aguardando', 'conectando', 'conectado']

function LivePanel({ i, active, className }: { i: number; active: boolean; className?: string }) {
  const durations = CHOREO[i]!
  const { ref, step } = useStepper<HTMLDivElement>({ durations, loop: false, enabled: active })
  return (
    <div ref={ref} className={className}>
      {i === 0 && <ConnectPanel state={CONNECT[step]} />}
      {i === 1 && <TeachPanel filled={step} />}
      {i === 2 && <AutomationsPanel on={step} />}
      {i === 3 && <WorkingPanel count={step} />}
    </div>
  )
}

export function HowItWorks() {
  const [active, setActive] = useState(0)
  const refs = useRef<(HTMLLIElement | null)[]>([])
  // Os painéis do bloco fixo só existem depois de hidratar (o bloco tem altura fixa e fica abaixo da dobra): o HTML
  // inicial leva uma cópia só de cada painel (a empilhada), o que deixa a página mais leve.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.step))
        }
      },
      { rootMargin: '-45% 0px -45% 0px' },
    )
    refs.current.forEach((el) => el && io.observe(el))
    return () => io.disconnect()
  }, [])

  return (
    <section id="como-funciona" aria-labelledby="t-como" style={{ containIntrinsicSize: 'auto 3600px' }} className="lp-cv relative bg-[#0a0f0c] py-24 text-dark-text min-[768px]:py-36">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(50% 30% at 75% 20%, rgba(46,154,72,.16), transparent 70%)' }} />
      <div className={`${wrap} relative`}>
        <div className="max-w-[760px]">
          <p className={cn(eyebrow, 'text-dark-accent-400')}>Como funciona</p>
          <h2 id="t-como" className="mt-5 text-balance text-[34px] font-semibold leading-[1.05] tracking-[-0.035em] text-white min-[768px]:text-[48px] min-[1200px]:text-[56px]">
            Quatro passos. Depois, é com o PearChat.
          </h2>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-6 [@media(min-width:1024px)_and_(min-height:700px)]:mt-8 [@media(min-width:1024px)_and_(min-height:700px)]:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] [@media(min-width:1024px)_and_(min-height:700px)]:gap-16">
          <ol className="m-0 list-none p-0">
            {STEPS.map((s, i) => (
              <li
                key={s.titulo}
                ref={(el) => {
                  refs.current[i] = el
                }}
                data-step={i}
                className="flex flex-col justify-center py-10 [@media(min-width:1024px)_and_(min-height:700px)]:min-h-[72vh] [@media(min-width:1024px)_and_(min-height:700px)]:py-0"
              >
                <div>
                  <span className="text-[13px] font-medium tabular-nums tracking-[.08em] text-dark-accent-400">{String(i + 1).padStart(2, '0')} / 04</span>
                  <h3
                    className={cn(
                      'mt-3 text-balance text-[28px] font-semibold leading-[1.1] tracking-[-0.03em] text-white transition-colors duration-500 min-[768px]:text-[36px]',
                      active !== i && '[@media(min-width:1024px)_and_(min-height:700px)]:text-dark-neutral-500',
                    )}
                  >
                    {s.titulo}
                  </h3>
                  <p className="mt-4 max-w-[46ch] text-[16.5px] leading-[1.6] text-dark-neutral-400 [text-wrap:pretty]">{s.texto}</p>
                </div>
                {/* Telas menores ou baixas: o painel vem logo abaixo do texto e anima ao aparecer */}
                <div className="mt-8 [@media(min-width:1024px)_and_(min-height:700px)]:hidden">
                  <p className="sr-only">{s.alt}</p>
                  <div aria-hidden="true">
                    <LivePanel i={i} active className="max-w-[640px]" />
                  </div>
                </div>
              </li>
            ))}
          </ol>

          <div className="hidden [@media(min-width:1024px)_and_(min-height:700px)]:block">
            <div className="sticky top-[14vh] flex h-[72vh] min-h-[520px] flex-col">
              <div className="flex gap-2" aria-hidden="true">
                {STEPS.map((s, i) => (
                  <span key={s.titulo} className="h-1 flex-1 overflow-hidden rounded-pill bg-white/10">
                    <span className={cn('block h-full origin-left rounded-pill bg-dark-accent-500 transition-transform duration-500', i <= active ? 'scale-x-100' : 'scale-x-0')} />
                  </span>
                ))}
              </div>
              <div className="relative mt-6 flex-1 overflow-hidden rounded-[24px] border border-white/[.07] bg-[radial-gradient(120%_80%_at_50%_0%,rgba(92,203,110,.10),rgba(255,255,255,.02))]">
                <p className="sr-only" aria-live="polite">
                  {STEPS[active]!.alt}
                </p>
                {mounted && STEPS.map((s, i) => (
                  <div
                    key={s.titulo}
                    aria-hidden="true"
                    className={cn(
                      'absolute inset-0 grid place-items-center p-10 transition-[opacity,transform] duration-700 [transition-timing-function:cubic-bezier(.2,.8,.2,1)]',
                      i === active ? 'translate-y-0 scale-100 opacity-100' : cn('pointer-events-none opacity-0', i < active ? '-translate-y-6 scale-[.97]' : 'translate-y-6 scale-[.97]'),
                    )}
                  >
                    <LivePanel i={i} active={i === active} className="w-full max-w-[560px]" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <p className="mx-auto mt-24 max-w-[16ch] text-balance text-center text-[40px] font-semibold leading-[1.02] tracking-[-0.04em] text-white min-[768px]:mt-36 min-[768px]:text-[64px] min-[1200px]:text-[76px]">
          Uma tela. <span className="text-dark-accent-400">Todo o seu atendimento.</span>
        </p>
      </div>
    </section>
  )
}

'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { AutomationsPanel, ConnectPanel, TeachPanel, WorkingPanel } from '../mini/how-panels'
import { eyebrow, wrap } from '../ui/styles'

// "Como funciona": no desktop a interface fica presa (sticky) e o texto rola; a etapa visível no meio da tela
// (IntersectionObserver) decide qual painel aparece. Abaixo de 1024 px cada etapa mostra o seu painel logo abaixo do texto.

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

function Panel({ i, className }: { i: number; className?: string }) {
  if (i === 0) return <ConnectPanel className={className} />
  if (i === 1) return <TeachPanel className={className} />
  if (i === 2) return <AutomationsPanel className={className} />
  return <WorkingPanel className={className} />
}

export function HowItWorks() {
  const [active, setActive] = useState(0)
  const refs = useRef<(HTMLLIElement | null)[]>([])

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
    <section id="como-funciona" aria-labelledby="t-como" className="relative bg-[#0a0f0c] py-24 text-dark-text min-[768px]:py-36">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(50% 30% at 75% 20%, rgba(46,154,72,.16), transparent 70%)' }} />
      <div className={`${wrap} relative`}>
        <div className="max-w-[760px]">
          <p className={cn(eyebrow, 'text-dark-accent-400')}>Como funciona</p>
          <h2 id="t-como" className="mt-5 text-balance text-[34px] font-semibold leading-[1.05] tracking-[-0.035em] text-white min-[768px]:text-[48px] min-[1200px]:text-[56px]">
            Quatro passos. Depois, é com o PearChat.
          </h2>
        </div>

        <div className="mt-16 grid grid-cols-1 gap-10 min-[1024px]:mt-8 min-[1024px]:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] min-[1024px]:gap-16">
          <ol className="m-0 list-none p-0">
            {STEPS.map((s, i) => (
              <li
                key={s.titulo}
                ref={(el) => {
                  refs.current[i] = el
                }}
                data-step={i}
                className="flex flex-col justify-center py-10 min-[1024px]:min-h-[72vh] min-[1024px]:py-0"
              >
                <div className={cn('transition-opacity duration-500 min-[1024px]:opacity-35', active === i && 'min-[1024px]:opacity-100')}>
                  <span className="text-[13px] font-medium tabular-nums tracking-[.08em] text-dark-accent-400">{String(i + 1).padStart(2, '0')} / 04</span>
                  <h3 className="mt-3 text-balance text-[28px] font-semibold leading-[1.1] tracking-[-0.03em] text-white min-[768px]:text-[36px]">{s.titulo}</h3>
                  <p className="mt-4 max-w-[46ch] text-[16.5px] leading-[1.6] text-dark-neutral-400 [text-wrap:pretty]">{s.texto}</p>
                </div>
                {/* Celular e tablet: o painel vem logo abaixo do texto */}
                <div className="mt-8 min-[1024px]:hidden">
                  <p className="sr-only">{s.alt}</p>
                  <div aria-hidden="true">
                    <Panel i={i} />
                  </div>
                </div>
              </li>
            ))}
          </ol>

          <div className="hidden min-[1024px]:block">
            <div className="sticky top-[14vh] flex h-[72vh] min-h-[520px] flex-col">
              <div className="flex gap-2" aria-hidden="true">
                {STEPS.map((s, i) => (
                  <span key={s.titulo} className="h-1 flex-1 overflow-hidden rounded-pill bg-white/10">
                    <span className={cn('block h-full rounded-pill bg-dark-accent-500 transition-[width] duration-500', i <= active ? 'w-full' : 'w-0')} />
                  </span>
                ))}
              </div>
              <div className="relative mt-6 flex-1 overflow-hidden rounded-[24px] border border-white/[.07] bg-[radial-gradient(120%_80%_at_50%_0%,rgba(92,203,110,.10),rgba(255,255,255,.02))]">
                <p className="sr-only" aria-live="polite">
                  {STEPS[active]!.alt}
                </p>
                {STEPS.map((s, i) => (
                  <div
                    key={s.titulo}
                    aria-hidden="true"
                    className={cn(
                      'absolute inset-0 grid place-items-center p-10 transition-[opacity,transform] duration-500',
                      i === active ? 'opacity-100' : 'pointer-events-none translate-y-3 opacity-0',
                    )}
                  >
                    <Panel i={i} className="w-full max-w-[560px]" />
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

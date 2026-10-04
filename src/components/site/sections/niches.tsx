'use client'

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { Icon } from '@phosphor-icons/react'
import { Cake, FirstAidKit, ForkKnife, HairDryer, PawPrint, Scissors, Storefront, Wrench } from '@phosphor-icons/react/dist/ssr'
import { cn } from '@/lib/utils'
import { usePlay } from '../anim/use-play'
import { AGENTE, Avatar, Bubble } from '../ui/primitives'
import { eyebrow, h2, wrap } from '../ui/styles'

// Para quem é: passar o mouse, focar ou tocar num segmento troca a conversa de exemplo ao lado.
// Teclado: Tab chega na lista; setas para cima/baixo trocam de segmento.

type Nicho = { Icon: Icon; nome: string; negocio: string; cliente: string; pergunta: string; resposta: string }

export const NICHOS: Nicho[] = [
  { Icon: Scissors, nome: 'Barbearias', negocio: 'Barbearia Navalha', cliente: 'Diego Souza', pergunta: 'Tem horário hoje?', resposta: 'Tenho às 15h e às 17h30. Quer que eu reserve um deles para você?' },
  { Icon: HairDryer, nome: 'Beleza e estética', negocio: 'Studio Bella', cliente: 'Patrícia Gomes', pergunta: 'Quanto custa limpeza de pele?', resposta: 'A limpeza de pele custa R$ 120 e leva cerca de 1 hora. Quer ver os horários desta semana?' },
  { Icon: FirstAidKit, nome: 'Clínicas', negocio: 'Clínica Vida Plena', cliente: 'Roberto Lima', pergunta: 'Qual o valor da consulta?', resposta: 'A consulta custa R$ 200. Tenho horário na quinta às 10h. Posso reservar para você?' },
  { Icon: PawPrint, nome: 'Pet shops', negocio: 'Pet Amigo', cliente: 'Luana Ferraz', pergunta: 'Tem banho amanhã?', resposta: 'Tem sim! Amanhã às 9h ou às 11h. Qual é o porte do seu pet?' },
  { Icon: Cake, nome: 'Confeitarias', negocio: 'Doce Encanto', cliente: 'Aline Barros', pergunta: 'Quanto fica um bolo para 30 pessoas?', resposta: 'Os bolos para 30 pessoas começam em R$ 180. Pedimos 3 dias de antecedência.' },
  { Icon: ForkKnife, nome: 'Restaurantes', negocio: 'Cantina da Praça', cliente: 'Marcelo Dias', pergunta: 'Vocês abrem domingo no almoço?', resposta: 'Abrimos sim! Aos domingos servimos almoço das 11h30 às 15h30.' },
  { Icon: Storefront, nome: 'Lojas', negocio: 'Loja Aurora', cliente: 'Camila Duarte', pergunta: 'Vocês fazem troca?', resposta: 'Fazemos! A troca pode ser feita em até 30 dias, com a etiqueta e a nota.' },
  { Icon: Wrench, nome: 'Prestadores de serviço', negocio: 'Clima Certo', cliente: 'Eduardo Reis', pergunta: 'Fazem orçamento para instalar ar-condicionado?', resposta: 'Fazemos sim, e a visita para orçamento não tem custo. Qual bairro e qual dia ficam melhor?' },
]

export function Niches() {
  const [i, setI] = useState(0)
  const btns = useRef<(HTMLButtonElement | null)[]>([])
  const n = NICHOS[i]!

  // Telas sem hover (toque): alterna sozinha, devagar, até o primeiro toque na seção. Pausa fora da tela.
  const section = useRef<HTMLElement>(null)
  const { play } = usePlay(section)
  const [auto, setAuto] = useState(false)
  useEffect(() => {
    setAuto(window.matchMedia('(hover: none)').matches)
  }, [])
  useEffect(() => {
    if (!auto || !play) return
    const t = window.setInterval(() => setI((k) => (k + 1) % NICHOS.length), 3800)
    return () => window.clearInterval(t)
  }, [auto, play])
  const stopAuto = () => setAuto(false)

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, idx: number) => {
    const next = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? idx + 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? idx - 1 : null
    if (next === null) return
    e.preventDefault()
    const k = (next + NICHOS.length) % NICHOS.length
    setI(k)
    btns.current[k]?.focus()
  }

  return (
    <section ref={section} onPointerDown={stopAuto} onKeyDown={stopAuto} id="para-quem-e" aria-labelledby="t-quem" className="bg-white py-24 min-[768px]:py-36">
      <div className={wrap}>
        <div className="grid grid-cols-1 gap-14 min-[1024px]:grid-cols-[minmax(0,6fr)_minmax(0,6fr)] min-[1024px]:gap-20">
          <div>
            <p className={cn(eyebrow, 'text-light-accent-300')}>Para quem é</p>
            <h2 id="t-quem" className={cn(h2, 'mt-5 max-w-[16ch]')}>
              Feito para quem atende clientes pelo WhatsApp.
            </h2>
            <div role="group" aria-label="Segmentos" className="mt-10 grid grid-cols-1 gap-x-6 min-[560px]:grid-cols-2">
              {NICHOS.map((x, idx) => {
                const on = idx === i
                return (
                  <button
                    key={x.nome}
                    ref={(el) => {
                      btns.current[idx] = el
                    }}
                    type="button"
                    aria-pressed={on}
                    onMouseEnter={() => setI(idx)}
                    onFocus={() => setI(idx)}
                    onClick={() => setI(idx)}
                    onKeyDown={(e) => onKey(e, idx)}
                    className={cn(
                      'group flex min-h-[56px] items-center gap-3.5 border-b border-light-divider py-4 text-left text-[18px] font-medium tracking-[-0.01em] transition-colors duration-200 min-[768px]:text-[20px]',
                      on ? 'text-light-text' : 'text-light-neutral-500 hover:text-light-text',
                    )}
                  >
                    <span
                      className={cn(
                        'grid h-10 w-10 flex-none place-items-center rounded-[11px] border transition-colors duration-200',
                        on ? 'border-light-accent-500 bg-light-accent-fill text-white' : 'border-light-divider bg-light-bg text-light-neutral-400',
                      )}
                    >
                      <x.Icon size={19} weight={on ? 'fill' : 'regular'} aria-hidden="true" />
                    </span>
                    {x.nome}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="relative min-[1024px]:pt-6">
            <div className="sticky top-28 overflow-hidden rounded-[24px] bg-light-bg p-5 min-[560px]:p-8" style={{ background: 'radial-gradient(80% 60% at 80% 0%, rgba(122,204,74,.18), transparent 70%), #f6f7ef' }}>
              <div className="overflow-hidden rounded-[14px] bg-white shadow-[0_0_0_1px_rgba(29,33,23,.07),0_24px_60px_-18px_rgba(29,33,23,.28)]" aria-live="polite">
                <div className="flex items-center gap-2.5 border-b border-light-divider px-4 py-3">
                  <Avatar nome={n.cliente} size={36} ia />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-medium leading-tight">{n.cliente}</div>
                    <div className="mt-0.5 text-[11px] text-light-neutral-500">WhatsApp · {n.negocio}</div>
                  </div>
                </div>
                <div key={i} className="flex h-[280px] flex-col justify-end gap-2.5 overflow-hidden bg-light-bg px-4 py-5 min-[560px]:px-5">
                  <p className="sr-only">
                    Exemplo para {n.nome.toLowerCase()}: o cliente pergunta “{n.pergunta}” e a IA responde “{n.resposta}”
                  </p>
                  <div aria-hidden="true" className="flex flex-col gap-2.5">
                    <Bubble from="cliente" time="09:14" className="text-[14px]">
                      {n.pergunta}
                    </Bubble>
                    <Bubble from="ia" time="09:14" className="text-[14px]">
                      {n.resposta}
                    </Bubble>
                  </div>
                </div>
              </div>
              <p className="mt-5 text-[13.5px] leading-[1.55] text-light-neutral-400">
                A {AGENTE} é só um exemplo de nome. Você escolhe como o seu agente se chama e o que ele sabe.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import Image from 'next/image'
import { useMotionValueEvent, useScroll } from 'motion/react'
import type { Icon } from '@phosphor-icons/react'
import { Bell, CalendarCheck, ChatCircleDots, CheckCircle, Clock, Sparkle } from '@phosphor-icons/react/dist/ssr'
import { cn } from '@/lib/utils'
import { useReducedMotion } from '../anim/use-play'
import { wrap } from '../ui/styles'

/*
 * Seção escura de impacto: a linha do tempo de um atendimento que acontece sozinho, com o PearChat no centro.
 * Os seis acontecimentos acendem em sequência conforme a área dos cartões rola pela tela (useScroll do motion), e um
 * ponto de luz percorre a linha em U até o cartão ativo (offset-path, só transform). Sem JavaScript ou com movimento
 * reduzido, tudo aparece aceso.
 */
export type ActivityState = 'idle' | 'active' | 'done'
type Item = { Icon: Icon; titulo: string; detalhe: string; hora: string }

export const IMPACT_ITEMS: Item[] = [
  { Icon: ChatCircleDots, titulo: 'Nova mensagem', detalhe: '“Oi, vocês têm horário amanhã?”', hora: '10:12' },
  { Icon: Sparkle, titulo: 'IA respondeu', detalhe: 'Luna ofereceu os horários livres', hora: '10:12' },
  { Icon: Clock, titulo: 'Cliente escolheu horário', detalhe: 'Amanhã, às 16:00', hora: '10:13' },
  { Icon: CalendarCheck, titulo: 'Agendamento criado', detalhe: 'Corte de cabelo · sex, 16:00', hora: '10:13' },
  { Icon: Bell, titulo: 'Lembrete programado', detalhe: 'Vai sair 2 h antes do horário', hora: '10:13' },
  { Icon: CheckCircle, titulo: 'Presença confirmada', detalhe: 'Rafael respondeu “1”', hora: 'sex, 14:02' },
]
const LAST = IMPACT_ITEMS.length - 1

function stateOf(i: number, active: number): ActivityState {
  return i < active ? 'done' : i === active ? 'active' : 'idle'
}

function ActivityCard({ item, n, state, className, style }: { item: Item; n: number; state: ActivityState; className?: string; style?: CSSProperties }) {
  const { Icon } = item
  return (
    <div
      className={cn(
        'flex items-center gap-3.5 rounded-[14px] border p-3.5 transition-[opacity,border-color,box-shadow,background-color] duration-500',
        state === 'active'
          ? 'border-dark-accent-600 bg-[linear-gradient(180deg,rgba(92,203,110,.14),rgba(92,203,110,.04))] shadow-[0_0_0_1px_rgba(92,203,110,.15),0_20px_50px_-20px_rgba(92,203,110,.55)]'
          : 'border-white/[.09] bg-[linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.02))]',
        state === 'idle' && 'opacity-40',
        className,
      )}
      style={style}
    >
      <span
        className={cn(
          'grid h-10 w-10 flex-none place-items-center rounded-[11px] border transition-colors duration-500',
          state === 'active' ? 'border-dark-accent-500 bg-dark-accent-500 text-[#06200f]' : 'border-dark-accent-700 bg-dark-accent-900 text-dark-accent-300',
        )}
      >
        <Icon size={19} weight={state === 'active' ? 'fill' : 'regular'} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="text-[11px] font-medium tabular-nums text-dark-neutral-500">{String(n).padStart(2, '0')}</span>
          <span className="flex-1 truncate text-[14.5px] font-medium text-white">{item.titulo}</span>
          <span className="flex-none text-[11px] tabular-nums text-dark-neutral-500">{item.hora}</span>
        </span>
        <span className="mt-1 block truncate text-[12.5px] text-dark-neutral-400">{item.detalhe}</span>
      </span>
    </div>
  )
}

function Hub({ className, lit }: { className?: string; lit: boolean }) {
  return (
    <div className={cn('relative grid place-items-center', className)}>
      <span className="absolute inset-[-34px] rounded-pill border border-dark-accent-500/10" />
      <span className="absolute inset-[-14px] rounded-pill border border-dark-accent-500/20" />
      <span
        className={cn(
          'absolute inset-0 grid place-items-center rounded-pill border border-white/10 bg-[radial-gradient(circle_at_35%_30%,#1b3a26,#08110b_70%)] transition-shadow duration-700',
          lit ? 'shadow-[0_0_90px_-6px_rgba(92,203,110,.6),inset_0_1px_0_rgba(255,255,255,.08)]' : 'shadow-[0_0_60px_-14px_rgba(92,203,110,.35),inset_0_1px_0_rgba(255,255,255,.08)]',
        )}
      >
        <Image src="/brand/pearchat-symbol.svg" alt="" width={46} height={73} unoptimized style={{ width: '34%', height: 'auto' }} />
      </span>
    </div>
  )
}

// Cena desktop (1100 × 480): três cartões à esquerda (descendo), três à direita (subindo), linha em U entre eles.
const W = 1100
const H = 480
const CARD_W = 340
const LEFT_X = 40
const RIGHT_X = W - 40 - CARD_W
const ROWS = [20, 170, 320]
const CY = 37 // meio do cartão
const LINE_L = LEFT_X + CARD_W + 24
const LINE_R = RIGHT_X - 24
const Y0 = ROWS[0]! + CY
const Y2 = ROWS[2]! + CY
const BOTTOM = Y2 + 95
const MID = W / 2
const U_PATH = `M${LINE_L} ${Y0} L${LINE_L} ${Y2} C${LINE_L} ${BOTTOM - 15} ${LINE_L + 60} ${BOTTOM} ${MID} ${BOTTOM} C${LINE_R - 60} ${BOTTOM} ${LINE_R} ${BOTTOM - 15} ${LINE_R} ${Y2} L${LINE_R} ${Y0}`

/** Comprimento de uma curva cúbica (amostrado). Calculado uma vez, igual no servidor e no navegador. */
function cubicLen(p0: number[], p1: number[], p2: number[], p3: number[]) {
  let len = 0
  let prev = p0
  for (let i = 1; i <= 40; i++) {
    const t = i / 40
    const u = 1 - t
    const pt = [0, 1].map((k) => u * u * u * p0[k]! + 3 * u * u * t * p1[k]! + 3 * u * t * t * p2[k]! + t * t * t * p3[k]!)
    len += Math.hypot(pt[0]! - prev[0]!, pt[1]! - prev[1]!)
    prev = pt
  }
  return len
}
const VERT = Y2 - Y0
const CURVE = cubicLen([LINE_L, Y2], [LINE_L, BOTTOM - 15], [LINE_L + 60, BOTTOM], [MID, BOTTOM]) * 2
const TOTAL = VERT * 2 + CURVE
const STOPS = [0, ROWS[1]! - ROWS[0]!, VERT, VERT + CURVE, VERT + CURVE + (ROWS[2]! - ROWS[1]!), TOTAL].map((d) => d / TOTAL)

export function Impact() {
  const reduced = useReducedMotion()
  const [active, setActive] = useState(LAST)
  const desk = useRef<HTMLDivElement>(null)
  const mob = useRef<HTMLDivElement>(null)
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => setHydrated(true), [])

  const track = (p: number) => setActive(p <= 0.001 ? -1 : Math.min(LAST, Math.floor(p * (LAST + 1.2))))
  const dScroll = useScroll({ target: desk, offset: ['start 0.85', 'end 0.5'] })
  const mScroll = useScroll({ target: mob, offset: ['start 0.8', 'end 0.6'] })
  useMotionValueEvent(dScroll.scrollYProgress, 'change', (p) => !reduced && desk.current?.offsetParent && track(p))
  useMotionValueEvent(mScroll.scrollYProgress, 'change', (p) => !reduced && mob.current?.offsetParent && track(p))
  useEffect(() => {
    if (!hydrated) return
    if (reduced) return setActive(LAST)
    const el = desk.current?.offsetParent ? dScroll : mScroll
    track(el.scrollYProgress.get())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, reduced])

  const pos = [
    { x: LEFT_X, y: ROWS[0]! },
    { x: LEFT_X, y: ROWS[1]! },
    { x: LEFT_X, y: ROWS[2]! },
    { x: RIGHT_X, y: ROWS[2]! },
    { x: RIGHT_X, y: ROWS[1]! },
    { x: RIGHT_X, y: ROWS[0]! },
  ]
  const frac = active < 0 ? 0 : STOPS[active]!

  return (
    <section aria-labelledby="t-impacto" className="relative overflow-hidden bg-[#050807] py-24 text-dark-text min-[768px]:py-32">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(42% 38% at 50% 62%, rgba(46,154,72,.22), transparent 70%), radial-gradient(60% 40% at 50% 0%, rgba(30,74,46,.35), transparent 70%)' }}
      />
      <div className={`${wrap} relative`}>
        <div className="lp-reveal mx-auto max-w-[900px] text-center">
          <p className="text-balance text-[20px] font-medium leading-[1.3] tracking-[-0.01em] text-dark-neutral-400 min-[768px]:text-[26px]">
            Não é só uma IA respondendo mensagens.
          </p>
          <h2 id="t-impacto" className="mt-3 text-balance text-[40px] font-semibold leading-[1.02] tracking-[-0.04em] text-white min-[768px]:text-[64px] min-[1200px]:text-[76px]">
            É o seu atendimento funcionando sozinho.
          </h2>
        </div>

        <p className="sr-only">
          Exemplo do que acontece sem ninguém tocar no celular: nova mensagem, a IA responde, o cliente escolhe o horário, o
          agendamento é criado, o lembrete é programado e a presença é confirmada.
        </p>

        {/* Desktop: cena com linha em U e o PearChat ao centro */}
        <div ref={desk} aria-hidden="true" className="relative mx-auto mt-20 hidden max-w-full min-[1140px]:block" style={{ width: W, height: H }}>
          <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${W} ${H}`} fill="none">
            <path d={U_PATH} stroke="#5ccb6e" strokeOpacity="0.18" strokeWidth="1.5" />
            <path
              d={U_PATH}
              pathLength={1}
              stroke="#5ccb6e"
              strokeOpacity="0.85"
              strokeWidth="1.5"
              strokeDasharray="1 1"
              strokeDashoffset={1 - frac}
              className="transition-[stroke-dashoffset] duration-700 ease-out"
            />
            <path d={`M${MID} ${BOTTOM} L${MID} 324`} stroke="#5ccb6e" strokeOpacity="0.35" strokeWidth="1.5" strokeDasharray="3 5" />
            {pos.map((p, i) => {
              const lx = p.x === LEFT_X ? LINE_L : LINE_R
              const edge = p.x === LEFT_X ? LEFT_X + CARD_W : RIGHT_X
              const cy = p.y + CY
              const st = stateOf(i, active)
              return (
                <g key={i}>
                  <path d={`M${edge} ${cy} L${lx} ${cy}`} stroke="#5ccb6e" strokeOpacity={st === 'idle' ? 0.12 : 0.45} strokeWidth="1.5" className="transition-[stroke-opacity] duration-500" />
                  <circle cx={lx} cy={cy} r="4" fill={st === 'idle' ? '#1e4a2e' : '#5ccb6e'} className="transition-[fill] duration-500" />
                </g>
              )
            })}
          </svg>
          {/* Ponto de luz que percorre a linha até o cartão ativo */}
          <span
            className={cn('absolute left-0 top-0 h-3 w-3 rounded-pill bg-dark-accent-400 shadow-[0_0_0_6px_rgba(92,203,110,.18),0_0_22px_4px_rgba(92,203,110,.65)] transition-[offset-distance,opacity] duration-700 ease-out', active < 0 && 'opacity-0')}
            style={{ offsetPath: `path('${U_PATH}')`, offsetDistance: `${frac * 100}%`, offsetRotate: '0deg' } as CSSProperties}
          />
          {IMPACT_ITEMS.map((it, i) => (
            <ActivityCard key={it.titulo} item={it} n={i + 1} state={stateOf(i, active)} className="absolute" style={{ left: pos[i]!.x, top: pos[i]!.y, width: CARD_W }} />
          ))}
          <div className="absolute left-1/2 top-[70px] -translate-x-1/2 text-center">
            <Hub className="mx-auto h-[172px] w-[172px]" lit={active >= 0} />
            <div className="mt-12 text-[13px] font-medium tracking-[.02em] text-dark-neutral-300">PearChat</div>
          </div>
        </div>

        {/* Até 1139 px: linha do tempo vertical */}
        <div ref={mob} aria-hidden="true" className="relative mx-auto mt-14 max-w-[520px] min-[1140px]:hidden">
          <Hub className="mx-auto mb-12 h-[120px] w-[120px]" lit={active >= 0} />
          <div className="relative">
            <span className="absolute bottom-6 left-[19px] top-6 w-px bg-dark-accent-500/20" />
            <span
              className="absolute bottom-6 left-[19px] top-6 w-px origin-top bg-gradient-to-b from-dark-accent-500/40 to-dark-accent-500 transition-transform duration-700 ease-out"
              style={{ transform: `scaleY(${active < 0 ? 0 : active / LAST})` }}
            />
            <ol className="m-0 flex list-none flex-col gap-3 p-0">
              {IMPACT_ITEMS.map((it, i) => (
                <li key={it.titulo} className="relative pl-12">
                  <span
                    className={cn(
                      'absolute left-[15px] top-1/2 h-[9px] w-[9px] -translate-y-1/2 rounded-pill transition-colors duration-500',
                      stateOf(i, active) === 'idle' ? 'bg-dark-accent-700' : 'bg-dark-accent-500',
                    )}
                  />
                  <ActivityCard item={it} n={i + 1} state={stateOf(i, active)} />
                </li>
              ))}
            </ol>
          </div>
        </div>

        <p className="lp-reveal mx-auto mt-16 max-w-[34ch] text-balance text-center text-[20px] leading-[1.4] tracking-[-0.01em] text-dark-neutral-300 min-[768px]:mt-20 min-[768px]:text-[26px]">
          Enquanto você cuida do negócio, o <span className="text-white">PearChat cuida das conversas.</span>
        </p>
      </div>
    </section>
  )
}

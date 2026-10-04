import type { CSSProperties } from 'react'
import Image from 'next/image'
import type { Icon } from '@phosphor-icons/react'
import { Bell, CalendarCheck, ChatCircleDots, CheckCircle, Clock, Sparkle } from '@phosphor-icons/react/dist/ssr'
import { cn } from '@/lib/utils'
import { wrap } from '../ui/styles'

/*
 * Seção escura de impacto: a linha do tempo de um atendimento que acontece sozinho, com o PearChat no centro.
 * Máquina de estados para a etapa 2: `active` = índice do acontecimento em destaque (0 a 5); anteriores ficam
 * "feitos", posteriores "aguardando". Hoje é estático com todos feitos e o último em destaque.
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

function stateOf(i: number, active: number): ActivityState {
  return i < active ? 'done' : i === active ? 'active' : 'idle'
}

function ActivityCard({ item, n, state, className, style }: { item: Item; n: number; state: ActivityState; className?: string; style?: CSSProperties }) {
  const { Icon } = item
  return (
    <div
      className={cn(
        'flex items-center gap-3.5 rounded-[14px] border p-3.5 backdrop-blur-sm transition-[opacity,border-color,box-shadow] duration-500',
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
          'grid h-10 w-10 flex-none place-items-center rounded-[11px] border',
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

function Hub({ className }: { className?: string }) {
  return (
    <div className={cn('relative grid place-items-center', className)}>
      <span className="absolute inset-[-34px] rounded-pill border border-dark-accent-500/10" />
      <span className="absolute inset-[-14px] rounded-pill border border-dark-accent-500/20" />
      <span className="absolute inset-0 grid place-items-center rounded-pill border border-white/10 bg-[radial-gradient(circle_at_35%_30%,#1b3a26,#08110b_70%)] shadow-[0_0_80px_-10px_rgba(92,203,110,.45),inset_0_1px_0_rgba(255,255,255,.08)]">
        <Image src="/brand/pearchat-symbol.svg" alt="" width={46} height={73} unoptimized style={{ width: '34%', height: 'auto' }} />
      </span>
    </div>
  )
}

// Coordenadas da cena desktop (1100 × 600): três cartões à esquerda (descendo), três à direita (subindo), linha em U.
const LEFT_X = 0
const RIGHT_X = 760
const CARD_W = 340
const ROWS = [24, 214, 404]
const LINE_L = 372
const LINE_R = 728

export function Impact({ active = IMPACT_ITEMS.length - 1 }: { active?: number }) {
  const pos = [
    { x: LEFT_X, y: ROWS[0] },
    { x: LEFT_X, y: ROWS[1] },
    { x: LEFT_X, y: ROWS[2] },
    { x: RIGHT_X, y: ROWS[2] },
    { x: RIGHT_X, y: ROWS[1] },
    { x: RIGHT_X, y: ROWS[0] },
  ]
  return (
    <section aria-labelledby="t-impacto" className="relative overflow-hidden bg-[#050807] py-24 text-dark-text min-[768px]:py-36">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(42% 38% at 50% 60%, rgba(46,154,72,.22), transparent 70%), radial-gradient(60% 40% at 50% 0%, rgba(30,74,46,.35), transparent 70%)' }}
      />
      <div className={`${wrap} relative`}>
        <div className="mx-auto max-w-[900px] text-center">
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
        <div aria-hidden="true" className="relative mx-auto mt-20 hidden h-[600px] w-[1100px] max-w-full min-[1140px]:block">
          <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1100 600" fill="none">
            <defs>
              <linearGradient id="lp-u" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#5ccb6e" stopOpacity="0.15" />
                <stop offset="0.5" stopColor="#5ccb6e" stopOpacity="0.7" />
                <stop offset="1" stopColor="#5ccb6e" stopOpacity="0.95" />
              </linearGradient>
            </defs>
            <path
              d={`M${LINE_L} 70 L${LINE_L} 450 C${LINE_L} 540 420 560 550 560 C680 560 ${LINE_R} 540 ${LINE_R} 450 L${LINE_R} 70`}
              stroke="url(#lp-u)"
              strokeWidth="1.5"
            />
            <path d="M550 560 L550 372" stroke="#5ccb6e" strokeOpacity="0.35" strokeWidth="1.5" strokeDasharray="3 5" />
            {pos.map((p, i) => {
              const lx = p.x === LEFT_X ? LINE_L : LINE_R
              const edge = p.x === LEFT_X ? LEFT_X + CARD_W : RIGHT_X
              const cy = p.y + 46
              const st = stateOf(i, active)
              return (
                <g key={i}>
                  <path d={`M${edge} ${cy} L${lx} ${cy}`} stroke="#5ccb6e" strokeOpacity={st === 'idle' ? 0.12 : 0.4} strokeWidth="1.5" />
                  <circle cx={lx} cy={cy} r={st === 'active' ? 6 : 4} fill={st === 'idle' ? '#1e4a2e' : '#5ccb6e'} />
                  {st === 'active' && <circle cx={lx} cy={cy} r="12" fill="#5ccb6e" fillOpacity="0.18" />}
                </g>
              )
            })}
          </svg>
          {IMPACT_ITEMS.map((it, i) => (
            <ActivityCard key={it.titulo} item={it} n={i + 1} state={stateOf(i, active)} className="absolute" style={{ left: pos[i]!.x, top: pos[i]!.y, width: CARD_W }} />
          ))}
          <div className="absolute left-1/2 top-[110px] -translate-x-1/2 text-center">
            <Hub className="mx-auto h-[172px] w-[172px]" />
            <div className="mt-12 text-[13px] font-medium tracking-[.02em] text-dark-neutral-300">PearChat</div>
          </div>
        </div>

        {/* Até 1139 px: linha do tempo vertical */}
        <div aria-hidden="true" className="relative mx-auto mt-14 max-w-[520px] min-[1140px]:hidden">
          <Hub className="mx-auto mb-12 h-[120px] w-[120px]" />
          <div className="relative">
            <span className="absolute bottom-6 left-[19px] top-6 w-px bg-gradient-to-b from-dark-accent-500/20 via-dark-accent-500/60 to-dark-accent-500" />
            <ol className="m-0 flex list-none flex-col gap-3 p-0">
              {IMPACT_ITEMS.map((it, i) => (
                <li key={it.titulo} className="relative pl-12">
                  <span className={cn('absolute left-[15px] top-1/2 h-[9px] w-[9px] -translate-y-1/2 rounded-pill', stateOf(i, active) === 'idle' ? 'bg-dark-accent-700' : 'bg-dark-accent-500')} />
                  <ActivityCard item={it} n={i + 1} state={stateOf(i, active)} />
                </li>
              ))}
            </ol>
          </div>
        </div>

        <p className="mx-auto mt-16 max-w-[34ch] text-balance text-center text-[20px] leading-[1.4] tracking-[-0.01em] text-dark-neutral-300 min-[768px]:mt-20 min-[768px]:text-[26px]">
          Enquanto você cuida do negócio, o <span className="text-white">PearChat cuida das conversas.</span>
        </p>
      </div>
    </section>
  )
}

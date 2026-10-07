'use client'

import type { ReactNode } from 'react'
import {
  ArrowsClockwise,
  CalendarCheck,
  CalendarDots,
  CalendarX,
  ChatCircle,
  ChatCircleDots,
  ClockClockwise,
  Gauge,
  Hand,
  PaperPlaneTilt,
  Plugs,
  PlugsConnected,
  Sparkle,
  Trash,
  UserPlus,
  WarningCircle,
} from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { quandoAgenda } from '@/server/notifications/format'
import type { NotificationDTO } from '@/server/notifications/types'
import { horaRelativa } from './time'

type Estilo = 'cheio' | 'suave' | 'ambar'

/** Ícone e estilo da caixinha por tipo. "cheio" é o quadrado verde do cartão "Novo agendamento" da página inicial. */
function iconeDe(tipo: string, aberto: boolean): { icone: ReactNode; estilo: Estilo } {
  const p = { size: 18 } as const
  switch (tipo) {
    case 'agenda_novo':
      return { icone: <CalendarCheck {...p} weight="bold" />, estilo: 'cheio' }
    case 'agenda_confirmado':
      return { icone: <CalendarCheck {...p} weight="bold" />, estilo: 'cheio' }
    case 'agenda_remarcado':
      return { icone: <ArrowsClockwise {...p} />, estilo: 'suave' }
    case 'agenda_cancelado':
      return { icone: <CalendarX {...p} />, estilo: 'ambar' }
    case 'agenda_remarcar':
      return { icone: <CalendarDots {...p} />, estilo: 'ambar' }
    case 'ia_respondeu':
      return { icone: <Sparkle {...p} weight="fill" />, estilo: 'suave' }
    case 'passou_para_voce':
      return { icone: <Hand {...p} weight="fill" />, estilo: 'ambar' }
    case 'esperando_resposta':
      return { icone: <ChatCircleDots {...p} weight="fill" />, estilo: 'ambar' }
    case 'nova_conversa':
      return { icone: <ChatCircle {...p} weight="fill" />, estilo: 'suave' }
    case 'followup':
      return { icone: <ClockClockwise {...p} />, estilo: 'suave' }
    case 'campanha':
      return { icone: <PaperPlaneTilt {...p} weight="fill" />, estilo: 'suave' }
    case 'falha_envio':
      return { icone: <WarningCircle {...p} weight="fill" />, estilo: 'ambar' }
    case 'whatsapp_desconectou':
      return { icone: <Plugs {...p} weight="fill" />, estilo: 'ambar' }
    case 'whatsapp_reconectou':
      return { icone: <PlugsConnected {...p} weight="fill" />, estilo: 'suave' }
    case 'equipe_convite':
      return { icone: <UserPlus {...p} weight="fill" />, estilo: 'suave' }
    case 'cota_ia':
      return { icone: <Gauge {...p} weight="fill" />, estilo: aberto ? 'ambar' : 'suave' }
    default:
      return { icone: <ChatCircle {...p} />, estilo: 'suave' }
  }
}

const ESTILO: Record<Estilo, string> = {
  cheio: 'bg-light-accent-fill text-white',
  suave: 'border border-solid border-light-accent-700 bg-light-accent-900 text-light-accent-300',
  ambar: 'border border-solid border-amber-border bg-amber-bg text-amber-text',
}

/** Linha secundária. Agendamentos refazem o dia relativo na hora de mostrar ("amanhã" envelhece): "Rafael Costa · amanhã, 16:00". */
export function corpoDe(n: NotificationDTO, agoraMs: number, tz: string): string | null {
  if (n.dados?.cliente && n.dados.inicio && !n.dados.agregado) return `${n.dados.cliente} · ${quandoAgenda(n.dados.inicio, agoraMs, tz)}`
  return n.corpo
}

const ORIGEM: Record<string, string> = { ia: 'Pela IA', link: 'Pelo link de agendamento' }

export function NotificationItem({
  n,
  agoraMs,
  tz,
  destacada,
  onAbrir,
  onApagar,
}: {
  n: NotificationDTO
  agoraMs: number
  /** Fuso do espaço (useAppState().locale.timezone): "hoje", "amanhã" e as horas seguem o relógio do negócio. */
  tz: string
  /** Ainda destacada como nova (não lida, ou lida há instantes enquanto o painel está aberto). */
  destacada: boolean
  onAbrir: (n: NotificationDTO) => void
  onApagar: (n: NotificationDTO) => void
}) {
  const corpo = corpoDe(n, agoraMs, tz)
  const origem = n.dados?.origem ? ORIGEM[n.dados.origem] : null
  const { icone, estilo } = iconeDe(n.tipo, n.dados?.nivel === 100)
  const alta = n.prioridade === 'alta'
  return (
    <li className="group relative list-none">
      <button
        type="button"
        onClick={() => onAbrir(n)}
        className={cn(
          'flex w-full cursor-pointer items-start gap-3 border-0 border-t border-solid border-light-divider px-4 py-3 pr-11 text-left text-light-text',
          destacada ? 'bg-light-accent-900' : 'bg-transparent hover:bg-light-neutral-900',
          destacada && 'hover:bg-light-accent-800',
        )}
        style={alta && destacada ? { boxShadow: 'inset 3px 0 0 #b0872f' } : undefined}
      >
        <span aria-hidden="true" className={cn('grid h-9 w-9 flex-none place-items-center rounded-[10px]', ESTILO[estilo])}>
          {icone}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={cn('line-clamp-2 flex-1 text-[12.5px] leading-tight', destacada ? 'font-medium' : 'font-normal')}>{n.titulo}</span>
            <time dateTime={n.ocorridoEm} className="flex-none text-[10.5px] text-light-neutral-500">
              {horaRelativa(n.ocorridoEm, agoraMs, tz)}
            </time>
          </span>
          {corpo ? <span className="mt-0.5 line-clamp-2 block text-[11.5px] leading-snug text-light-neutral-500">{corpo}</span> : null}
          {origem ? <span className="mt-0.5 block text-[10.5px] text-light-neutral-600">{origem}</span> : null}
        </span>
        {destacada ? (
          <span aria-label="Não lida" role="img" className="mt-1.5 h-2 w-2 flex-none rounded-pill bg-light-accent-fill" />
        ) : null}
      </button>
      <button
        type="button"
        onClick={() => onApagar(n)}
        aria-label={`Apagar: ${n.titulo}`}
        title="Apagar"
        className="absolute bottom-2 right-2 grid h-7 w-7 place-items-center rounded-md border-0 bg-transparent p-0 text-light-neutral-500 opacity-0 transition-opacity hover:bg-[rgba(29,33,23,.09)] hover:text-light-text focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
      >
        <Trash size={14} aria-hidden="true" />
      </button>
    </li>
  )
}

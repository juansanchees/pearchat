'use client'

import { CaretRight, Check, GoogleLogo, Info, PencilSimple, Plus } from '@phosphor-icons/react'
import { PearSwitch } from '@/components/pear'
import { cn } from '@/lib/utils'
import type { Lembrete } from '@/server/calendar/types'
import { BookingLinkSettings } from './booking-link-settings'
import { DUR_OPTS, LEMBRETE_OPTS } from './data'

/** Card "Preferências": duração padrão, nota do WhatsApp oficial, lembretes e rodapé com a conta Google. */
export function Preferences({
  duracao,
  onDuracao,
  lembretes,
  onToggleLembrete,
  pedirConfirmacao,
  onPedirConfirmacao,
  tiposCount,
  onEditTipos,
  oficial,
  email,
  demo,
  disconnecting,
  onDisconnect,
  conectado = true,
}: {
  duracao: 30 | 60 | 120
  onDuracao: (d: 30 | 60 | 120) => void
  lembretes: Lembrete[]
  onToggleLembrete: (l: Lembrete) => void
  /** O lembrete pede "1 para confirmar, 2 para remarcar". */
  pedirConfirmacao: boolean
  onPedirConfirmacao: (on: boolean) => void
  tiposCount: number
  onEditTipos: () => void
  oficial: boolean
  email: string
  demo?: boolean
  disconnecting: boolean
  onDisconnect: () => void
  /** Sem Google conectado: só tipos de atendimento e link de agendamento (o resto grava na conexão). */
  conectado?: boolean
}) {
  return (
    <div className="flex flex-col gap-3 rounded-md bg-light-surface p-4">
      <h2 className="m-0 text-[14px] font-medium leading-[1.2] tracking-normal">Preferências</h2>
      {conectado && (
        <div>
          <div className="pc-label">Duração padrão</div>
          <div className="pc-seg" role="group" aria-label="Duração padrão">
            {DUR_OPTS.map((o) => (
              <button
                key={o.min}
                type="button"
                className="pc-seg-opt"
                aria-pressed={o.min === duracao}
                onClick={() => o.min !== duracao && onDuracao(o.min)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={onEditTipos}
        className="pc-btn pc-btn-secondary w-full justify-between px-2.5 py-2 text-[12.5px]"
      >
        <span className="flex items-center gap-1.5">
          <PencilSimple size={13} className="text-light-accent-300" /> Tipos de atendimento · {tiposCount}
        </span>
        <CaretRight size={12} className="text-light-neutral-500" />
      </button>
      {conectado && (
        <>
        {oficial && (
          <div className="flex gap-1.5 text-[11px] text-light-neutral-500 [text-wrap:pretty]">
            <Info size={12} className="mt-px flex-none" />
            <span>
              Pelo WhatsApp oficial, o lembrete usa o modelo aprovado <b className="font-semibold">lembrete_agendamento</b> e, por enquanto, não pede confirmação.
            </span>
          </div>
        )}
        <div className="text-[12px] text-light-neutral-400">Lembrete no WhatsApp</div>
        <div className="flex flex-wrap gap-1.5">
          {LEMBRETE_OPTS.map((o) => {
            const on = lembretes.includes(o.value)
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={on}
                onClick={() => onToggleLembrete(o.value)}
                className={cn(
                  'flex cursor-pointer items-center gap-[5px] rounded-pill border border-solid px-2.5 py-[5px] text-[11.5px]',
                  on
                    ? 'border-light-accent-600 bg-light-accent-900 text-light-accent-200'
                    : 'border-light-divider bg-transparent text-light-neutral-400',
                )}
              >
                {on ? <Check size={11} /> : <Plus size={11} />}
                {o.label}
              </button>
            )
          })}
        </div>
        <div className="flex items-center gap-2.5">
          <div className="min-w-0 flex-1">
            <div className="text-[12px] text-light-neutral-400">Pedir confirmação no lembrete</div>
            <div className="text-[11px] text-light-neutral-500">O cliente responde 1 para confirmar ou 2 para remarcar.</div>
          </div>
          <PearSwitch size="sm" checked={pedirConfirmacao} onChange={onPedirConfirmacao} label="Pedir confirmação no lembrete" />
        </div>
        </>
      )}
      <BookingLinkSettings />
      {conectado && (
        <div className="flex items-center gap-2.5 border-0 border-t border-solid border-light-divider pt-2.5">
          <GoogleLogo size={15} className="flex-none text-light-accent-300" />
          <div className="min-w-0 flex-1 truncate text-[11.5px] text-light-neutral-400" title={email}>
            {email}
            {demo ? ' (demonstração)' : ''}
          </div>
          <button
            type="button"
            onClick={onDisconnect}
            disabled={disconnecting}
            className="pc-btn pc-btn-ghost px-2 py-1 text-[11.5px]"
          >
            Desconectar
          </button>
        </div>
      )}
    </div>
  )
}

'use client'

import { useState } from 'react'
import { CalendarPlus, Check, GoogleLogo, Sparkle, TrashSimple, User } from '@phosphor-icons/react'
import { Spinner } from '@/components/pear'
import { cn } from '@/lib/utils'
import type { EventDto, EventOrigem } from '@/server/calendar/types'
import { TIPOS_AG } from './data'
import { GRID_END_HOUR, GRID_START_HOUR, durLabel, toSp } from './time'

const cardCls = 'flex flex-col rounded-md bg-light-surface p-4'

function origemInfo(origem: EventOrigem, agentName: string) {
  if (origem === 'IA') return { label: `${agentName} · IA`, icon: <Sparkle size={10} /> }
  if (origem === 'GOOGLE') return { label: 'Google', icon: <GoogleLogo size={10} /> }
  return { label: 'Manual', icon: <User size={10} /> }
}

/** Aviso para compromissos fora da faixa visível da grade (08h às 19h). */
function foraDaGrade(ev: EventDto): string | null {
  if (ev.diaInteiro) return null
  const start = toSp(ev.inicio).hours
  const end = start + ev.duracaoMin / 60
  if (end <= GRID_START_HOUR) return `antes das ${GRID_START_HOUR}h`
  if (start >= GRID_END_HOUR) return `depois das ${GRID_END_HOUR}h`
  return null
}

/** Card com os compromissos do dia selecionado (ou "Dia livre"). */
export function DayCard({
  title,
  events,
  agentName,
  onDelete,
}: {
  title: string
  events: EventDto[]
  agentName: string
  /** Exclui o evento; devolve true se excluiu. */
  onDelete: (id: string) => Promise<boolean>
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const remove = async (id: string) => {
    setDeletingId(id)
    await onDelete(id)
    setDeletingId(null)
    setConfirmId(null)
  }

  return (
    <div className={cn(cardCls, 'gap-2.5')}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="m-0 text-[14px] font-medium leading-[1.2] tracking-normal">{title}</h2>
        <div className="whitespace-nowrap text-[11px] text-light-neutral-500">
          {events.length} {events.length === 1 ? 'compromisso' : 'compromissos'}
        </div>
      </div>
      {events.map((ev) => {
        const o = origemInfo(ev.origem, agentName)
        const fora = foraDaGrade(ev)
        return (
          <div key={ev.id} className="flex gap-[11px] rounded-md border border-solid border-light-divider px-[11px] py-2.5">
            <div className="w-[42px] flex-none">
              <div className="text-[12.5px] font-medium leading-none text-light-accent-200">
                {ev.diaInteiro ? 'Dia todo' : toSp(ev.inicio).hm}
              </div>
              <div className="mt-1 text-[10.5px] text-light-neutral-500">{ev.diaInteiro ? '' : durLabel(ev.duracaoMin)}</div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-medium leading-[1.25]">{ev.titulo}</div>
              <div className="mt-[3px] text-[11.5px] text-light-neutral-500">
                {ev.somenteLeitura ? (ev.agenda ?? 'Google Agenda') : (ev.cliente ?? 'Cliente sem nome')}
              </div>
              <div className="mt-[5px] flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] text-light-accent-300">
                <span className="flex items-center gap-1">
                  {ev.somenteLeitura && ev.cor ? (
                    <span className="h-[8px] w-[8px] flex-none rounded-pill" style={{ background: ev.cor }} />
                  ) : (
                    o.icon
                  )}
                  {o.label}
                </span>
                {fora && <span className="text-light-neutral-500">{fora}</span>}
              </div>
            </div>
            <div className="flex flex-none items-start">
              {ev.somenteLeitura ? null : confirmId === ev.id ? (
                <div className="flex items-center gap-1 text-[11px] text-light-neutral-400" role="group" aria-label="Confirmar exclusão">
                  <span>Excluir?</span>
                  <button
                    type="button"
                    disabled={deletingId === ev.id}
                    onClick={() => void remove(ev.id)}
                    className="rounded-md border-0 bg-transparent px-1.5 py-0.5 text-[11px] font-medium text-light-accent-300 hover:bg-[rgba(29,33,23,.07)] disabled:opacity-60"
                  >
                    {deletingId === ev.id ? 'Excluindo…' : 'Sim'}
                  </button>
                  <button
                    type="button"
                    disabled={deletingId === ev.id}
                    onClick={() => setConfirmId(null)}
                    className="rounded-md border-0 bg-transparent px-1.5 py-0.5 text-[11px] text-light-neutral-400 hover:bg-[rgba(29,33,23,.07)]"
                  >
                    Não
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  title="Excluir agendamento"
                  aria-label={`Excluir ${ev.titulo}`}
                  onClick={() => setConfirmId(ev.id)}
                  className="grid h-6 w-6 place-items-center rounded-md border-0 bg-transparent p-0 text-light-neutral-500 hover:bg-[rgba(29,33,23,.07)] hover:text-light-text"
                >
                  <TrashSimple size={13} />
                </button>
              )}
            </div>
          </div>
        )
      })}
      {events.length === 0 && (
        <div className="rounded-md border border-dashed border-light-divider p-4 text-center text-[12px] text-light-neutral-500">
          Dia livre. Toque em um horário na grade para agendar.
        </div>
      )}
    </div>
  )
}

/** Card "Novo agendamento": cliente, tipo, pílulas de horários livres e botão "Agendar {dia}, {hora}". */
export function NewBooking({
  cliente,
  onCliente,
  tipo,
  onTipo,
  diaCurto,
  horarios,
  loadingFree,
  freeError,
  hora,
  onHora,
  saving,
  onSubmit,
}: {
  cliente: string
  onCliente: (v: string) => void
  tipo: string
  onTipo: (v: string) => void
  diaCurto: string
  horarios: string[]
  loadingFree: boolean
  freeError: boolean
  hora: string
  onHora: (h: string) => void
  saving: boolean
  onSubmit: () => void
}) {
  return (
    <div className={cn(cardCls, 'gap-2.5')}>
      <h2 className="m-0 flex items-center gap-[7px] text-[14px] font-medium leading-[1.2] tracking-normal">
        <CalendarPlus size={15} className="text-light-accent-300" /> Novo agendamento
      </h2>
      <input
        className="pc-input"
        value={cliente}
        onChange={(e) => onCliente(e.target.value)}
        placeholder="Nome do cliente"
        aria-label="Nome do cliente"
        maxLength={120}
      />
      <select className="pc-input" value={tipo} onChange={(e) => onTipo(e.target.value)} aria-label="Tipo de agendamento">
        {TIPOS_AG.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <div className="flex items-center gap-2 text-[11.5px] text-light-neutral-500">
        Horários livres · {diaCurto}
        {loadingFree && <Spinner size={12} />}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {horarios.map((h) => {
          const on = h === hora
          return (
            <button
              key={h}
              type="button"
              aria-pressed={on}
              onClick={() => onHora(h)}
              className={cn(
                'cursor-pointer rounded-pill border border-solid px-[11px] py-1.5 text-[12px]',
                on
                  ? 'border-light-accent-600 bg-light-accent-900 text-light-accent-200'
                  : 'border-light-divider bg-light-surface text-light-neutral-400',
              )}
            >
              {h}
            </button>
          )
        })}
        {!loadingFree && horarios.length === 0 && (
          <div className="text-[12px] text-light-neutral-500">
            {freeError ? 'Não foi possível consultar os horários.' : 'Nenhum horário livre neste dia.'}
          </div>
        )}
      </div>
      <button type="button" onClick={onSubmit} disabled={saving} className="pc-btn pc-btn-primary mt-[5.6px] w-full">
        {saving ? <Spinner size={14} /> : <Check size={14} />} {hora ? `Agendar ${diaCurto}, ${hora}` : 'Escolha um horário'}
      </button>
    </div>
  )
}

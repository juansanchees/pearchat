'use client'

import { ArrowClockwise, CaretLeft, CaretRight, Sparkle } from '@phosphor-icons/react'
import { Spinner } from '@/components/pear'
import { cn } from '@/lib/utils'
import type { EventDto } from '@/server/calendar/types'
import { ORIGEM_BAR } from './data'
import { GRID_END_HOUR, GRID_HOURS, GRID_START_HOUR, HOUR_PX, dayNumber, semLabel, toSp } from './time'

export type GridDay = { date: string; isToday: boolean }

/** Posição do evento na coluna: top = (h − 8) × 52 + 2; altura = duração × 52 − 4 (recortado à faixa 08–19 h). */
function place(ev: EventDto) {
  const start = toSp(ev.inicio).hours
  const end = start + ev.duracaoMin / 60
  const a = Math.max(start, GRID_START_HOUR)
  const b = Math.min(end, GRID_END_HOUR)
  if (b <= a) return null
  return {
    top: Math.round((a - GRID_START_HOUR) * HOUR_PX + 2),
    height: Math.max(16, Math.round((b - a) * HOUR_PX - 4)),
  }
}

/** Colunas lado a lado para eventos que se sobrepõem no mesmo dia (comum com agendas do Google). */
function layoutColumns(items: { ev: EventDto; start: number; end: number }[]) {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end)
  const out = new Map<string, { col: number; cols: number }>()
  let cluster: { id: string; col: number; end: number }[] = []
  let clusterEnd = -1
  const flush = () => {
    const cols = cluster.reduce((m, c) => Math.max(m, c.col + 1), 1)
    for (const c of cluster) out.set(c.id, { col: c.col, cols })
    cluster = []
  }
  for (const it of sorted) {
    if (cluster.length > 0 && it.start >= clusterEnd) flush()
    const used = new Set(cluster.filter((c) => c.end > it.start).map((c) => c.col))
    let col = 0
    while (used.has(col)) col++
    cluster.push({ id: it.ev.id, col, end: it.end })
    clusterEnd = Math.max(cluster.length === 1 ? -1 : clusterEnd, it.end)
  }
  flush()
  return out
}

const MAX_CHIPS = 2

export function WeekGrid({
  title,
  range,
  days,
  selIdx,
  selHora,
  eventsByDate,
  loading,
  error,
  onRetry,
  onPrev,
  onNext,
  onToday,
  onPickDay,
  onPickSlot,
}: {
  title: string
  range: string
  days: GridDay[]
  selIdx: number
  selHora: string
  eventsByDate: Map<string, EventDto[]>
  loading: boolean
  error: boolean
  onRetry: () => void
  onPrev: () => void
  onNext: () => void
  onToday: () => void
  onPickDay: (i: number) => void
  onPickSlot: (i: number, hora: string) => void
}) {
  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-md bg-light-surface max-[899px]:h-[560px]">
      <div className="flex items-center gap-2.5 border-0 border-b border-solid border-light-divider px-4 py-3">
        <h2 className="m-0 text-[15px] font-medium leading-[1.2] tracking-normal">{title}</h2>
        <div className="text-[12px] text-light-neutral-500">{range}</div>
        {loading && <Spinner size={14} />}
        <div className="flex-1" />
        <button type="button" onClick={onPrev} aria-label="Semana anterior" className="pc-btn pc-btn-ghost h-[30px] w-[30px] p-0">
          <CaretLeft size={14} />
        </button>
        <button type="button" onClick={onToday} className="pc-btn pc-btn-secondary px-[11px] py-1 text-[12px]">
          Hoje
        </button>
        <button type="button" onClick={onNext} aria-label="Próxima semana" className="pc-btn pc-btn-ghost h-[30px] w-[30px] p-0">
          <CaretRight size={14} />
        </button>
      </div>

      <div className="grid grid-cols-[52px_repeat(7,minmax(0,1fr))] border-0 border-b border-solid border-light-divider">
        <div />
        {days.map((d, i) => {
          const sel = i === selIdx
          return (
            <button
              key={d.date}
              type="button"
              onClick={() => onPickDay(i)}
              className={cn(
                'flex cursor-pointer flex-col items-center gap-1 border-0 border-l border-solid border-light-divider pb-2 pt-[9px]',
                sel ? 'bg-light-accent-900' : 'bg-transparent',
              )}
            >
              <span className={cn('text-[10.5px] uppercase tracking-[.06em]', sel ? 'text-light-accent-300' : 'text-light-neutral-500')}>
                {semLabel(d.date)}
              </span>
              <span
                className={cn(
                  'grid h-7 w-7 place-items-center rounded-pill text-[14px] font-medium leading-none',
                  d.isToday ? 'bg-light-accent-500 text-[#fbfcf3]' : sel ? 'bg-light-accent-800 text-light-accent-200' : 'text-light-text',
                )}
              >
                {dayNumber(d.date)}
              </span>
            </button>
          )
        })}
      </div>

      {days.some((d) => (eventsByDate.get(d.date) ?? []).some((e) => e.diaInteiro)) && (
        <div className="grid grid-cols-[52px_repeat(7,minmax(0,1fr))] border-0 border-b border-solid border-light-divider">
          <div className="px-1 pt-1.5 text-right text-[9.5px] leading-[1.2] text-light-neutral-500">Dia inteiro</div>
          {days.map((d) => {
            const all = (eventsByDate.get(d.date) ?? []).filter((e) => e.diaInteiro)
            return (
              <div key={d.date} className="flex min-w-0 flex-col gap-0.5 border-0 border-l border-solid border-light-divider p-[3px]">
                {all.slice(0, MAX_CHIPS).map((ev) => (
                  <div
                    key={ev.id}
                    title={`${ev.titulo}${ev.agenda ? ` · ${ev.agenda}` : ''}`}
                    className="truncate rounded-[5px] border border-l-[3px] border-solid border-light-divider bg-light-surface px-1.5 py-px text-[10.5px] leading-[1.35] text-light-accent-200"
                    style={{ borderLeftColor: ev.cor ?? ORIGEM_BAR[ev.origem] }}
                  >
                    {ev.titulo}
                  </div>
                ))}
                {all.length > MAX_CHIPS && (
                  <div className="px-1 text-[10px] text-light-neutral-500" title={all.slice(MAX_CHIPS).map((e) => e.titulo).join(', ')}>
                    +{all.length - MAX_CHIPS}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="relative min-h-0 flex-1 overflow-y-auto">
        {error && (
          <div className="absolute inset-x-0 top-3 z-10 mx-auto flex w-fit items-center gap-2.5 rounded-md bg-light-surface px-3 py-2 text-[12px] text-light-neutral-400 shadow-md">
            Não foi possível carregar os compromissos.
            <button type="button" onClick={onRetry} className="pc-btn pc-btn-ghost text-[12px]">
              <ArrowClockwise size={13} /> Tentar de novo
            </button>
          </div>
        )}
        <div className="relative grid grid-cols-[52px_repeat(7,minmax(0,1fr))]">
          <div>
            {GRID_HOURS.map((h) => (
              <div key={h} className="relative h-[52px]">
                <span className="absolute right-2 top-1 text-[10.5px] text-light-neutral-500">{h}</span>
              </div>
            ))}
          </div>
          {days.map((d, i) => {
            const sel = i === selIdx
            return (
              <div
                key={d.date}
                className={cn('relative border-0 border-l border-solid border-light-divider', sel && 'bg-[rgba(168,194,58,0.05)]')}
              >
                {GRID_HOURS.map((h) => (
                  <button
                    key={h}
                    type="button"
                    title={`Agendar às ${h}`}
                    onClick={() => onPickSlot(i, h)}
                    className={cn(
                      'block h-[52px] w-full cursor-pointer border-0 border-t border-solid border-light-divider p-0 hover:bg-light-accent-900',
                      sel && h === selHora ? 'bg-light-accent-800' : 'bg-transparent',
                    )}
                  />
                ))}
                {(() => {
                  const placed = (eventsByDate.get(d.date) ?? [])
                    .filter((e) => !e.diaInteiro)
                    .map((ev) => ({ ev, pos: place(ev) }))
                    .filter((x): x is { ev: EventDto; pos: NonNullable<ReturnType<typeof place>> } => x.pos !== null)
                  const cols = layoutColumns(placed.map((x) => ({ ev: x.ev, start: x.pos.top, end: x.pos.top + x.pos.height })))
                  return placed.map(({ ev, pos }) => {
                    const ia = ev.origem === 'IA'
                    const c = cols.get(ev.id) ?? { col: 0, cols: 1 }
                    return (
                      <div
                        key={ev.id}
                        title={`${toSp(ev.inicio).hm} · ${ev.titulo}${ev.agenda ? ` · ${ev.agenda}` : ''}`}
                        className={cn(
                          'pointer-events-none absolute overflow-hidden rounded-[7px] border border-l-[3px] border-solid px-[7px] py-[5px]',
                          ia ? 'border-light-accent-700 bg-light-accent-900' : 'border-light-divider bg-light-surface',
                        )}
                        style={{
                          top: pos.top,
                          height: pos.height,
                          left: `calc(${(c.col / c.cols) * 100}% + 4px)`,
                          width: `calc(${100 / c.cols}% - 8px)`,
                          borderLeftColor: ev.cor ?? ORIGEM_BAR[ev.origem],
                        }}
                      >
                        <div className="flex items-center gap-1 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] font-medium leading-[1.2] text-light-accent-200">
                          {ia && <Sparkle size={9} weight="fill" className="flex-none" />}
                          <span className="truncate">
                            {toSp(ev.inicio).hm} · {ev.titulo}
                          </span>
                        </div>
                        {ev.origem !== 'GOOGLE' && (
                          <div className="mt-0.5 truncate text-[10.5px] text-light-neutral-500">{ev.cliente ?? 'Cliente sem nome'}</div>
                        )}
                      </div>
                    )
                  })
                })()}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

import { CaretLeft, CaretRight, Check, Clock, GoogleLogo, LinkSimple, Sparkle } from '@/components/site/ui/icons'
import { cn } from '@/lib/utils'
import { AppWindow, Bubble, Tag } from '../ui/primitives'

/* ---------- Grade semanal (fiel a agenda/week-grid.tsx) ---------- */

const DAYS = [
  { sem: 'SEG', n: 13 },
  { sem: 'TER', n: 14, hoje: true },
  { sem: 'QUA', n: 15, sel: true },
  { sem: 'QUI', n: 16 },
  { sem: 'SEX', n: 17 },
  { sem: 'SÁB', n: 18 },
]
/** No celular a grade mostra só três dias (ter, qua, qui). */
const MOBILE_DAYS = [1, 2, 3]
const HOURS = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00']
const ROW = 44
const BAR = { IA: '#2e9a48', MANUAL: '#d9a35b', GOOGLE: '#6bb39a' } as const
type Origem = keyof typeof BAR
type Ev = { d: number; h: number; dur: number; titulo: string; cliente?: string; o: Origem; conf?: 'ok' | 'aguardando'; link?: boolean }

const EVENTS: Ev[] = [
  { d: 0, h: 9, dur: 1, titulo: 'Limpeza de pele', cliente: 'Paula Nunes', o: 'MANUAL', conf: 'ok' },
  { d: 0, h: 13, dur: 0.5, titulo: 'Design de sobrancelha', cliente: 'Lia Campos', o: 'IA' },
  { d: 1, h: 10, dur: 1, titulo: 'Massagem relaxante', cliente: 'Renata Dias', o: 'IA', conf: 'ok' },
  { d: 1, h: 15, dur: 1, titulo: 'Reunião com fornecedor', o: 'GOOGLE' },
  { d: 2, h: 10, dur: 0.5, titulo: 'Design de sobrancelha', cliente: 'Carla Melo', o: 'MANUAL', conf: 'aguardando' },
  { d: 3, h: 11, dur: 1, titulo: 'Limpeza de pele', cliente: 'Júlia Rocha', o: 'IA' },
  { d: 3, h: 16, dur: 1, titulo: 'Massagem relaxante', cliente: 'Bruna Lopes', o: 'MANUAL' },
  { d: 4, h: 9.5, dur: 1, titulo: 'Limpeza de pele', cliente: 'Sofia Lima', o: 'IA', conf: 'ok' },
  { d: 4, h: 14, dur: 0.5, titulo: 'Design de sobrancelha', cliente: 'Elisa Prado', o: 'MANUAL' },
  { d: 5, h: 10, dur: 1.5, titulo: 'Dia da noiva', cliente: 'Marina Torres', o: 'MANUAL', conf: 'ok' },
]
/** O agendamento novo, feito pelo link: Mariana Silva, quarta às 14:00. */
export const NEW_EVENT: Ev = { d: 2, h: 14, dur: 1, titulo: 'Limpeza de pele', cliente: 'Mariana Silva', o: 'IA', conf: 'ok', link: true }

const hm = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${h % 1 ? '30' : '00'}`

/**
 * Estados: `fresh` mostra o agendamento novo (com o destaque "Novo agendamento"); `confirmed` troca a etiqueta
 * para "Confirmado" depois que a cliente responde ao lembrete.
 */
export function WeekAgenda({ fresh = true, confirmed = true, className }: { fresh?: boolean; confirmed?: boolean; className?: string }) {
  const evs = fresh ? [...EVENTS, { ...NEW_EVENT, conf: confirmed ? ('ok' as const) : ('aguardando' as const) }] : EVENTS
  return (
    <AppWindow title="Agenda" className={className}>
      <div className="flex items-center gap-2.5 border-b border-light-divider px-4 py-3">
        <span className="text-[14px] font-medium">Outubro de 2026</span>
        <span className="hidden text-[11.5px] text-light-neutral-400 min-[480px]:inline">13 a 18 de out.</span>
        <span className="flex-1" />
        <span className="hidden items-center gap-1.5 rounded-pill border border-light-divider px-2.5 py-[4px] text-[10.5px] text-light-neutral-400 min-[560px]:inline-flex">
          <GoogleLogo size={11} /> Google Agenda conectado
        </span>
        <CaretLeft size={13} className="text-light-accent-300" />
        <span className="rounded-md border border-light-divider px-2.5 py-[3px] text-[11px]">Hoje</span>
        <CaretRight size={13} className="text-light-accent-300" />
      </div>
      <div className="grid grid-cols-[44px_repeat(3,minmax(0,1fr))] border-b border-light-divider min-[640px]:grid-cols-[44px_repeat(6,minmax(0,1fr))]">
        <div />
        {DAYS.map((d, i) => (
          <div key={d.n} className={cn('flex flex-col items-center gap-1 border-l border-light-divider pb-2 pt-[9px]', d.sel && 'bg-light-accent-900', !MOBILE_DAYS.includes(i) && 'max-[639px]:hidden')}>
            <span className={cn('text-[10px] uppercase tracking-[.06em]', d.sel ? 'text-light-accent-300' : 'text-light-neutral-400')}>{d.sem}</span>
            <span
              className={cn(
                'grid h-7 w-7 place-items-center rounded-pill text-[13px] font-medium leading-none',
                d.hoje ? 'bg-light-accent-fill text-white' : d.sel ? 'bg-light-accent-800 text-light-accent-200' : '',
              )}
            >
              {d.n}
            </span>
          </div>
        ))}
      </div>
      <div className="relative grid grid-cols-[44px_repeat(3,minmax(0,1fr))] min-[640px]:grid-cols-[44px_repeat(6,minmax(0,1fr))]">
        <div>
          {HOURS.map((h) => (
            <div key={h} className="relative" style={{ height: ROW }}>
              <span className="absolute right-1.5 top-1 text-[9.5px] text-light-neutral-400">{h}</span>
            </div>
          ))}
        </div>
        {DAYS.map((d, i) => (
          <div key={d.n} className={cn('relative border-l border-light-divider', d.sel && 'bg-[rgba(46,154,72,0.05)]', !MOBILE_DAYS.includes(i) && 'max-[639px]:hidden')}>
            {HOURS.map((h) => (
              <div key={h} className="border-t border-light-divider" style={{ height: ROW }} />
            ))}
            {evs
              .filter((e) => e.d === i)
              .map((e) => {
                const isNew = fresh && e === evs[evs.length - 1]
                return (
                  <div
                    key={`${e.h}-${e.titulo}`}
                    className={cn(
                      'absolute inset-x-[3px] overflow-hidden rounded-[7px] border border-l-[3px] px-[6px] py-[4px]',
                      e.o === 'IA' ? 'border-light-accent-700 bg-light-accent-900' : 'border-light-divider bg-white',
                      isNew && 'lp-pop z-10 shadow-[0_0_0_2px_#2e9a48,0_14px_30px_-10px_rgba(46,154,72,.7)]',
                    )}
                    style={{ top: (e.h - 9) * ROW + 2, height: e.dur * ROW - 4, borderLeftColor: BAR[e.o] }}
                  >
                    <div className="flex items-center gap-1 overflow-hidden text-[10px] font-medium leading-[1.2] text-light-accent-200">
                      {e.o === 'IA' && <Sparkle size={8} weight="fill" className="flex-none" />}
                      <span className="truncate">
                        {hm(e.h)} · {e.titulo}
                      </span>
                    </div>
                    {e.cliente && <div className="mt-0.5 truncate text-[9.5px] text-light-neutral-400">{e.cliente}</div>}
                    {e.dur >= 1 && (e.conf || e.link) && (
                      <div className="mt-1 flex gap-1 max-[1100px]:hidden">
                        {e.link && <Tag className="!rounded-[4px] !px-[5px] !py-px !text-[8.5px]">Link</Tag>}
                        {e.conf === 'ok' && <Tag className="!rounded-[4px] !px-[5px] !py-px !text-[8.5px]">Confirmado</Tag>}
                        {e.conf === 'aguardando' && (
                          <Tag tone="neutral" className="!rounded-[4px] !px-[5px] !py-px !text-[8.5px]">
                            Aguardando
                          </Tag>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            {fresh && i === NEW_EVENT.d && (
              <span
                className="lp-pop absolute inset-x-0 z-20 mx-auto w-fit whitespace-nowrap rounded-pill bg-light-text px-2.5 py-[5px] text-[10.5px] font-medium leading-none text-white shadow-lg"
                style={{ top: (NEW_EVENT.h - 9) * ROW - 22 }}
              >
                Novo agendamento
              </span>
            )}
          </div>
        ))}
      </div>
    </AppWindow>
  )
}

/* ---------- Celular com a página pública do link (fiel a booking/booking-flow.tsx) ---------- */

/** 0 escolher serviço · 1 escolher dia · 2 escolher horário · 3 pronto para confirmar · 4 agendamento confirmado */
export const BOOKING_FINAL = 4

function StepTitle({ n, done, children }: { n: number; done: boolean; children: string }) {
  return (
    <div className="flex items-center gap-2 text-[12px] font-medium leading-[1.2]">
      <span
        className={cn(
          'grid h-[18px] w-[18px] flex-none place-items-center rounded-pill border text-[9.5px] font-medium leading-none',
          done ? 'border-light-accent-600 bg-light-accent-800 text-light-accent-200' : 'border-light-divider text-light-neutral-400',
        )}
      >
        {done ? <Check size={9} weight="bold" /> : n}
      </span>
      {children}
    </div>
  )
}

const pillOn = 'border-light-accent-600 bg-light-accent-900 text-light-accent-200'
const pillOff = 'border-light-divider bg-white text-light-text'
const card = 'flex flex-col gap-2 rounded-[10px] border border-light-divider bg-white p-2.5 shadow-[0_4px_14px_rgba(29,33,23,.06)]'

export function BookingPhone({ step = 3, className }: { step?: number; className?: string }) {
  return (
    <div className={cn('rounded-[42px] bg-[#0d110e] p-[9px] shadow-[0_40px_80px_-24px_rgba(13,17,14,.55),inset_0_0_0_1px_rgba(255,255,255,.08)]', className)}>
      <div className="relative h-[560px] overflow-hidden rounded-[34px] bg-light-bg">
        <span className="absolute left-1/2 top-2 z-10 h-[22px] w-[84px] -translate-x-1/2 rounded-pill bg-[#0d110e]" />
        <div
          className="px-4 pb-8 pt-11 text-dark-text"
          style={{ background: 'radial-gradient(300px 160px at 10% 0%, #173322, transparent 70%), #14170f' }}
        >
          <p className="text-[8.5px] font-medium uppercase leading-none tracking-[0.12em] text-dark-accent-300">Agendamento online</p>
          <p className="mt-2 text-[19px] font-medium leading-[1.1] tracking-[-0.02em]">Studio Bella</p>
        </div>
        <div className="relative -mt-5 flex flex-col gap-2 px-2.5">
          {step >= BOOKING_FINAL ? (
            <div className={cn(card, 'items-center py-6 text-center')}>
              <span className="grid h-10 w-10 place-items-center rounded-pill bg-light-accent-fill text-white">
                <Check size={20} weight="bold" />
              </span>
              <div className="text-[13px] font-medium">Agendamento confirmado</div>
              <div className="text-[10.5px] text-light-neutral-400">Limpeza de pele · qua, 15 de out. · 14:00</div>
            </div>
          ) : (
            <>
              <div className={card}>
                <StepTitle n={1} done={step >= 1}>
                  Escolha o serviço
                </StepTitle>
                {[
                  ['Limpeza de pele', '1 h'],
                  ['Design de sobrancelha', '30 min'],
                ].map(([nome, dur], i) => {
                  const on = step >= 1 && i === 0
                  return (
                    <div key={nome} className={cn('flex items-center gap-2 rounded-md border px-2.5 py-2', on ? pillOn : 'border-light-divider')}>
                      <span className={cn('grid h-3 w-3 flex-none place-items-center rounded-pill border', on ? 'border-light-accent-400' : 'border-light-neutral-700')}>
                        {on && <span className="h-1.5 w-1.5 rounded-pill bg-light-accent-400" />}
                      </span>
                      <span className="flex-1 text-[11px] font-medium text-light-text">{nome}</span>
                      <span className="flex items-center gap-1 text-[9.5px] text-light-neutral-400">
                        <Clock size={9} />
                        {dur}
                      </span>
                    </div>
                  )
                })}
              </div>
              {step >= 1 && (
                <div className={card}>
                  <StepTitle n={2} done={step >= 2}>
                    Escolha o dia
                  </StepTitle>
                  <div className="flex gap-1.5">
                    {[
                      ['hoje', 14],
                      ['qua', 15],
                      ['qui', 16],
                      ['sex', 17],
                      ['sáb', 18],
                    ].map(([s, n]) => {
                      const on = step >= 2 && n === 15
                      return (
                        <span key={n} className={cn('flex h-[50px] flex-1 flex-col items-center justify-center gap-0.5 rounded-md border', on ? pillOn : pillOff)}>
                          <span className="text-[8.5px] uppercase leading-none text-light-neutral-400">{s}</span>
                          <span className="text-[14px] font-medium leading-none">{n}</span>
                        </span>
                      )
                    })}
                  </div>
                </div>
              )}
              {step >= 2 && (
                <div className={card}>
                  <StepTitle n={3} done={step >= 3}>
                    Escolha o horário
                  </StepTitle>
                  <div className="grid grid-cols-4 gap-1.5">
                    {['09:00', '11:00', '13:00', '14:00', '15:30', '16:00', '17:00', '18:00'].map((h) => (
                      <span key={h} className={cn('rounded-pill border py-[7px] text-center text-[10.5px]', step >= 3 && h === '14:00' ? pillOn : pillOff)}>
                        {h}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {step >= 3 && (
                <span className="mt-0.5 rounded-md bg-light-accent-400 py-2.5 text-center text-[11.5px] font-medium text-white">Confirmar agendamento</span>
              )}
            </>
          )}
        </div>
        <div className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-1 text-[9px] text-light-neutral-400">
          <LinkSimple size={10} /> Agendamento por PearChat
        </div>
      </div>
    </div>
  )
}

/* ---------- Lembrete com confirmação de presença ---------- */

/**
 * -1 escondido (ainda não saiu) · 0 lembrete enviado · 1 cliente responde "1" · 2 presença confirmada.
 * Os elementos ficam sempre no lugar e só aparecem (opacity/transform), para não mexer no layout.
 */
export function ReminderCard({ step = 2, className }: { step?: number; className?: string }) {
  const show = (on: boolean) => cn('transition-[opacity,transform] duration-500 ease-out', on ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0')
  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-[14px] border border-light-divider bg-light-bg/95 p-3 shadow-[0_24px_50px_-20px_rgba(29,33,23,.4)] backdrop-blur',
        show(step >= 0),
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 px-0.5">
        <span className="text-[10px] font-medium uppercase tracking-[.12em] text-light-neutral-400">Lembrete automático</span>
        <span className={cn('transition-opacity duration-300', step >= 2 ? 'opacity-100' : 'opacity-0')}>
          <Tag>Confirmado</Tag>
        </span>
      </div>
      <Bubble from="equipe" time="ter, 14:00" pop={false}>
        Lembrete: seu horário de Limpeza de pele é amanhã, às 14:00. Responda 1 para confirmar ou 2 para remarcar.
      </Bubble>
      <div className={show(step >= 1)}>
        <Bubble from="cliente" time="14:03" pop={false}>
          1
        </Bubble>
      </div>
    </div>
  )
}

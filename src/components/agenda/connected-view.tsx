'use client'

import { useEffect, useMemo, useState } from 'react'
import { CalendarCheck, Clock, GoogleLogo, Plugs, Trash, Warning } from '@phosphor-icons/react'
import { useAppState } from '@/components/app/app-state'
import { emitAgendaChanged } from '@/components/app/events'
import { Spinner } from '@/components/pear'
import type { CalendarStateDto, EventDeleteResponse, EventDto, EventWriteResponse, Lembrete } from '@/server/calendar/types'
import { LEMBRETES } from '@/server/calendar/types'
import { TIPOS_AG, api } from './data'
import { Preferences } from './preferences'
import { DayCard, NewBooking } from './side-panel'
import { addDays, longLabel, shortLabel, spInstant, spToday, toSp, weekRange, weekTitle } from './time'
import { useFreeSlots, useWeekEvents } from './use-agenda'
import { WeekGrid } from './week-grid'

export type CalendarPatch = Partial<Pick<CalendarStateDto, 'iaPodeAgendar' | 'duracaoPadraoMin' | 'lembretes'>>

/** Agenda conectada: grade semanal | coluna lateral (dia, novo agendamento, preferências). */
export function ConnectedView({
  cal,
  patch,
  onDisconnected,
  clienteParam,
  onSynced,
}: {
  cal: CalendarStateDto
  patch: (body: CalendarPatch) => Promise<boolean>
  onDisconnected: (next: CalendarStateDto) => void
  clienteParam: string | null
  /** Chamado com o instante da última leitura bem-sucedida do Google (para o status da barra superior). */
  onSynced?: (iso: string) => void
}) {
  const { toast, wa, agentName } = useAppState()

  // "Hoje" só é calculado no cliente (evita divergência de hidratação).
  const [today, setToday] = useState<string | null>(null)
  useEffect(() => setToday(spToday()), [])

  const [offset, setOffset] = useState(0)
  const [selIdx, setSelIdx] = useState(0)
  const [hora, setHora] = useState('')
  const [cliente, setCliente] = useState(clienteParam ?? '')
  const [tipo, setTipo] = useState(TIPOS_AG[0])
  const [saving, setSaving] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  useEffect(() => {
    if (clienteParam) setCliente(clienteParam)
  }, [clienteParam])

  const weekStart = today ? addDays(today, offset * 7) : null
  const days = useMemo(
    () => (weekStart ? Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).map((date) => ({ date, isToday: date === today })) : []),
    [weekStart, today],
  )
  const selDate = days[selIdx]?.date ?? null

  const week = useWeekEvents(weekStart)
  const free = useFreeSlots(selDate, cal.duracaoPadraoMin)

  const eventsByDate = useMemo(() => {
    const m = new Map<string, EventDto[]>()
    const put = (d: string, ev: EventDto) => m.set(d, [...(m.get(d) ?? []), ev])
    for (const ev of [...week.events].sort((a, b) => (a.inicio < b.inicio ? -1 : 1))) {
      const first = toSp(ev.inicio).date
      if (ev.diaInteiro) {
        // Dia inteiro (fim exclusivo): aparece em cada dia coberto.
        const last = toSp(new Date(new Date(ev.fim).getTime() - 1).toISOString()).date
        for (let d = first, n = 0; d <= last && n < 62; d = addDays(d, 1), n++) put(d, ev)
      } else {
        put(first, ev)
      }
    }
    return m
  }, [week.events])

  const { sincronizadoEm } = week
  useEffect(() => {
    if (sincronizadoEm && onSynced) onSynced(sincronizadoEm)
  }, [sincronizadoEm, onSynced])

  if (!today || !weekStart || !selDate) {
    return (
      <div className="grid flex-1 place-items-center">
        <Spinner />
      </div>
    )
  }

  const diaCurto = shortLabel(selDate, today)

  // Horários que já passaram hoje não são opção.
  const nowHm = toSp(new Date().toISOString()).hm
  const isToday = selDate === today
  const horariosLivres = isToday ? free.horarios.filter((h) => h > nowHm) : free.horarios

  const agendar = async () => {
    if (!hora) {
      toast({ icon: <Clock size={18} weight="fill" />, title: 'Escolha um horário', text: 'Toque em um dos horários livres' })
      return
    }
    if (isToday && hora <= nowHm) {
      toast({ icon: <Clock size={18} weight="fill" />, title: 'Esse horário já passou', text: 'Escolha um horário a partir de agora' })
      setHora('')
      return
    }
    if (saving) return
    setSaving(true)
    const nome = cliente.trim()
    try {
      const r = await api<EventWriteResponse>('/api/events', {
        method: 'POST',
        body: { inicio: spInstant(selDate, hora), duracaoMin: cal.duracaoPadraoMin, tipo, cliente: nome || null },
      })
      if (r.googleSync === 'falhou') {
        toast({
          icon: <Warning size={18} weight="fill" />,
          title: 'Salvo no PearChat, mas não foi possível enviar ao Google',
          text: `${nome || 'Cliente sem nome'} · ${diaCurto}, ${hora}`,
        })
      } else {
        toast({
          icon: <CalendarCheck size={18} weight="fill" />,
          title: 'Agendamento criado',
          text: `${nome || 'Cliente sem nome'} · ${diaCurto}, ${hora} · enviado ao Google Agenda`,
        })
      }
      setCliente('')
      setHora('')
      emitAgendaChanged()
    } catch (e) {
      toast({
        icon: <Warning size={18} weight="fill" />,
        title: 'Não foi possível agendar',
        text: e instanceof Error ? e.message : 'Tente novamente em instantes.',
      })
    } finally {
      setSaving(false)
      void week.reload()
      void free.reload()
    }
  }

  const excluir = async (id: string): Promise<boolean> => {
    try {
      const r = await api<EventDeleteResponse>(`/api/events/${id}`, { method: 'DELETE' })
      if (r.googleSync === 'falhou') {
        toast({
          icon: <Warning size={18} weight="fill" />,
          title: 'Excluído no PearChat, mas não foi possível remover do Google',
          text: 'Apague o evento direto no Google Agenda',
        })
      } else {
        toast({ icon: <Trash size={18} weight="fill" />, title: 'Agendamento excluído', text: 'Ele também sai do Google Agenda' })
      }
      emitAgendaChanged()
      void week.reload()
      void free.reload()
      return true
    } catch (e) {
      toast({
        icon: <Warning size={18} weight="fill" />,
        title: 'Não foi possível excluir',
        text: e instanceof Error ? e.message : 'Tente novamente em instantes.',
      })
      return false
    }
  }

  const toggleLembrete = (l: Lembrete) => {
    const next = cal.lembretes.includes(l) ? cal.lembretes.filter((x) => x !== l) : [...cal.lembretes, l]
    void patch({ lembretes: LEMBRETES.filter((x) => next.includes(x)) })
  }

  const desconectar = async () => {
    if (disconnecting) return
    setDisconnecting(true)
    try {
      const next = await api<CalendarStateDto>('/api/calendar', { method: 'DELETE' })
      toast({ icon: <Plugs size={18} weight="fill" />, title: 'Google Agenda desconectado', text: 'Os agendamentos param de sincronizar' })
      emitAgendaChanged()
      onDisconnected(next)
    } catch (e) {
      toast({
        icon: <Warning size={18} weight="fill" />,
        title: 'Não foi possível desconectar',
        text: e instanceof Error ? e.message : 'Tente novamente em instantes.',
      })
      setDisconnecting(false)
    }
  }

  const reconectar = cal.precisaReconectar || week.googleStatus === 'reconectar'
  const irParaGoogle = () => window.location.assign('/api/calendar/google/start')

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {reconectar ? (
        <Banner
          tone="warn"
          text="Sua conexão com o Google expirou. Os agendamentos continuam salvos aqui, mas não sincronizam até você reconectar."
          action="Reconectar"
          onAction={irParaGoogle}
        />
      ) : cal.demo && cal.googleConfigurado ? (
        <Banner tone="info" text="Você está no modo de demonstração." action="Conectar Google de verdade" onAction={irParaGoogle} />
      ) : week.googleStatus === 'falhou' ? (
        <Banner
          tone="warn"
          text="Não foi possível ler os compromissos do Google agora. Mostrando só os do PearChat."
          action="Tentar de novo"
          onAction={() => void week.reload()}
        />
      ) : null}
    <div className="grid min-h-0 flex-1 animate-zfIn grid-cols-[minmax(0,1fr)_minmax(280px,330px)] grid-rows-[minmax(0,1fr)] gap-4 p-4 max-[899px]:grid-cols-1 max-[899px]:grid-rows-none max-[899px]:content-start max-[899px]:overflow-y-auto max-[899px]:p-3">
      <WeekGrid
        title={weekTitle(weekStart)}
        range={weekRange(weekStart)}
        days={days}
        selIdx={selIdx}
        selHora={hora}
        eventsByDate={eventsByDate}
        loading={week.loading}
        error={week.error}
        onRetry={() => void week.reload()}
        onPrev={() => {
          setOffset((o) => o - 1)
          setHora('')
        }}
        onNext={() => {
          setOffset((o) => o + 1)
          setHora('')
        }}
        onToday={() => {
          setOffset(0)
          setSelIdx(0)
          setHora('')
        }}
        onPickDay={(i) => {
          setSelIdx(i)
          setHora('')
        }}
        onPickSlot={(i, h) => {
          setSelIdx(i)
          setHora(h)
        }}
      />

      <div className="flex min-h-0 flex-col gap-3.5 overflow-y-auto max-[899px]:overflow-visible">
        <DayCard title={longLabel(selDate, today)} events={eventsByDate.get(selDate) ?? []} agentName={agentName} onDelete={excluir} />
        <NewBooking
          cliente={cliente}
          onCliente={setCliente}
          tipo={tipo}
          onTipo={setTipo}
          diaCurto={diaCurto}
          horarios={horariosLivres}
          loadingFree={free.loading}
          freeError={free.error}
          hora={hora}
          onHora={setHora}
          saving={saving}
          onSubmit={() => void agendar()}
        />
        <Preferences
          duracao={cal.duracaoPadraoMin}
          onDuracao={(d) => void patch({ duracaoPadraoMin: d })}
          lembretes={cal.lembretes}
          onToggleLembrete={toggleLembrete}
          oficial={wa.provider === 'oficial'}
          email={cal.email || 'Google'}
          demo={cal.demo}
          disconnecting={disconnecting}
          onDisconnect={() => void desconectar()}
        />
      </div>
    </div>
    </div>
  )
}

function Banner({ tone, text, action, onAction }: { tone: 'info' | 'warn'; text: string; action: string; onAction: () => void }) {
  return (
    <div
      role={tone === 'warn' ? 'alert' : 'status'}
      className="mx-4 mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-solid border-light-divider bg-light-surface px-3 py-2 text-[12px] text-light-neutral-400 max-[899px]:mx-3"
    >
      {tone === 'warn' ? (
        <Warning size={14} weight="fill" className="flex-none text-light-accent-300" />
      ) : (
        <GoogleLogo size={14} className="flex-none text-light-accent-300" />
      )}
      <span className="min-w-0 flex-1 [text-wrap:pretty]">{text}</span>
      <button type="button" onClick={onAction} className="pc-btn pc-btn-secondary px-2.5 py-1 text-[12px]">
        {action}
      </button>
    </div>
  )
}

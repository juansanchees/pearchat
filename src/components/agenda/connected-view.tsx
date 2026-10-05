'use client'

import { useEffect, useMemo, useState } from 'react'
import { CalendarCheck, Clock, GoogleLogo, PencilSimple, Plugs, Trash, Warning } from '@phosphor-icons/react'
import { useAppState } from '@/components/app/app-state'
import { AGENDA_CHANGED, emitAgendaChanged } from '@/components/app/events'
import { usePermissions } from '@/components/app/use-permissions'
import { Spinner } from '@/components/pear'
import type { ServiceTypeDto } from '@/server/calendar/types'
import type { CalendarStateDto, EventDeleteResponse, EventDto, EventWriteResponse, Lembrete } from '@/server/calendar/types'
import { LEMBRETES } from '@/server/calendar/types'
import { api } from './data'
import { Preferences } from './preferences'
import { ServiceTypeEditor } from './service-type-editor'
import { DayCard, NewBooking } from './side-panel'
import { addDays, diffDays, longLabel, shortLabel, spInstant, spToday, toSp, weekRange, weekTitle } from './time'
import { useFreeSlots, useServiceTypes, useWeekEvents } from './use-agenda'
import { WeekGrid } from './week-grid'

export type CalendarPatch = Partial<Pick<CalendarStateDto, 'iaPodeAgendar' | 'duracaoPadraoMin' | 'lembretes' | 'pedirConfirmacao'>>

/** Agenda conectada: grade semanal | coluna lateral (dia, novo agendamento, preferências). */
export function ConnectedView({
  cal,
  patch,
  onDisconnected,
  clienteParam,
  diaParam = null,
  onDiaConsumido,
  onSynced,
  onConnectGoogle,
}: {
  cal: CalendarStateDto
  patch: (body: CalendarPatch) => Promise<boolean>
  onDisconnected: (next: CalendarStateDto) => void
  clienteParam: string | null
  /** Dia (AAAA-MM-DD) pedido por um link do sininho: a grade vai até ele e avisa que consumiu. */
  diaParam?: string | null
  onDiaConsumido?: () => void
  /** Chamado com o instante da última leitura bem-sucedida do Google (para o status da barra superior). */
  onSynced?: (iso: string) => void
  /** Sem Google conectado: abre o fluxo de conexão a partir do aviso no topo. */
  onConnectGoogle?: () => void
}) {
  const { toast, wa, agentName } = useAppState()
  // Atendente usa a agenda, mas não a gestão (Google, preferências, link, tipos): o servidor também barra (calendar.manage).
  const gerir = usePermissions().can('calendar.manage')

  // "Hoje" só é calculado no cliente (evita divergência de hidratação).
  const [today, setToday] = useState<string | null>(null)
  useEffect(() => setToday(spToday()), [])

  const [offset, setOffset] = useState(0)
  const [selIdx, setSelIdx] = useState(0)
  const [hora, setHora] = useState('')
  const [cliente, setCliente] = useState(clienteParam ?? '')
  const { tipos, setTipos } = useServiceTypes()
  const [tipoId, setTipoId] = useState('')
  const [duracao, setDuracao] = useState<number>(cal.duracaoPadraoMin)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<EventDto | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  useEffect(() => {
    if (clienteParam) setCliente(clienteParam)
  }, [clienteParam])

  // Seleciona o 1º tipo (e sua duração) quando os tipos chegam, ou quando o tipo escolhido deixa de existir.
  useEffect(() => {
    if (editing || tipos.length === 0) return
    if (!tipos.some((t) => t.id === tipoId)) {
      setTipoId(tipos[0].id)
      setDuracao(tipos[0].duracaoMin)
    }
  }, [tipos, tipoId, editing])

  const weekStart = today ? addDays(today, offset * 7) : null
  const days = useMemo(
    () => (weekStart ? Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).map((date) => ({ date, isToday: date === today })) : []),
    [weekStart, today],
  )
  const selDate = days[selIdx]?.date ?? null

  const week = useWeekEvents(weekStart)
  const free = useFreeSlots(selDate, duracao, editing?.id ?? null)

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

  // Agendamento novo por fora desta tela (ex.: cliente usou o link público): recarrega a grade e os horários.
  const { reload: reloadWeek } = week
  const { reload: reloadFree } = free
  useEffect(() => {
    const on = () => {
      void reloadWeek()
      void reloadFree()
    }
    window.addEventListener(AGENDA_CHANGED, on)
    return () => window.removeEventListener(AGENDA_CHANGED, on)
  }, [reloadWeek, reloadFree])

  const { sincronizadoEm } = week
  useEffect(() => {
    if (sincronizadoEm && onSynced) onSynced(sincronizadoEm)
  }, [sincronizadoEm, onSynced])

  /** Leva a grade e o dia selecionado até `date`. */
  const goToDate = (date: string) => {
    if (!today) return
    const diff = diffDays(today, date)
    const off = Math.floor(diff / 7)
    setOffset(off)
    setSelIdx(diff - off * 7)
  }

  // Link do sininho (?dia=AAAA-MM-DD): vai até o dia assim que "hoje" está calculado.
  useEffect(() => {
    if (!diaParam || !today) return
    if (/^\d{4}-\d{2}-\d{2}$/.test(diaParam)) goToDate(diaParam)
    onDiaConsumido?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diaParam, today])

  const changeTipo = (id: string) => {
    setTipoId(id)
    const t = tipos.find((x) => x.id === id)
    if (t) setDuracao(t.duracaoMin)
    setHora('')
  }

  const startEdit = (ev: EventDto) => {
    if (ev.somenteLeitura || ev.origem === 'GOOGLE') return
    const t = tipos.find((x) => x.id === ev.serviceTypeId) ?? tipos.find((x) => x.nome.toLowerCase() === ev.tipo.toLowerCase())
    const at = toSp(ev.inicio)
    setEditorOpen(false)
    setEditing(ev)
    setFocusId(ev.id)
    setCliente(ev.cliente ?? '')
    setTipoId(t?.id ?? '')
    setDuracao(ev.duracaoMin)
    goToDate(at.date)
    setHora(at.hm)
  }

  const cancelEdit = () => {
    setEditing(null)
    setCliente('')
    setHora('')
    const t = tipos[0] as ServiceTypeDto | undefined
    if (t) {
      setTipoId(t.id)
      setDuracao(t.duracaoMin)
    }
  }

  const tiposSalvos = (novos: ServiceTypeDto[]) => {
    setTipos(novos)
    setEditorOpen(false)
    const t = novos.find((x) => x.id === tipoId) ?? novos[0]
    if (t && !editing) {
      setTipoId(t.id)
      setDuracao(t.duracaoMin)
    }
    void free.reload()
  }

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
  const origAt = editing ? toSp(editing.inicio) : null
  const isOrigDay = origAt !== null && origAt.date === selDate
  let horariosLivres = isToday ? free.horarios.filter((h) => h > nowHm || (isOrigDay && h === origAt?.hm)) : free.horarios
  // Em edição, o horário atual do próprio agendamento sempre aparece (mesmo fora do passo de 30 min).
  if (origAt && isOrigDay && !free.loading && !horariosLivres.includes(origAt.hm) && !free.error) {
    horariosLivres = [...horariosLivres, origAt.hm].sort()
  }

  const agendar = async () => {
    if (!hora) {
      toast({ icon: <Clock size={18} weight="fill" />, title: 'Escolha um horário', text: 'Toque em um dos horários livres' })
      return
    }
    const mantemHorario = editing !== null && isOrigDay && hora === origAt?.hm
    if (isToday && hora <= nowHm && !mantemHorario) {
      toast({ icon: <Clock size={18} weight="fill" />, title: 'Esse horário já passou', text: 'Escolha um horário a partir de agora' })
      setHora('')
      return
    }
    if (saving) return
    setSaving(true)
    const nome = cliente.trim()
    try {
      if (editing) {
        const tipoSel = tipos.find((t) => t.id === tipoId)
        const body: Record<string, unknown> = { inicio: spInstant(selDate, hora), duracaoMin: duracao }
        if (nome !== (editing.cliente ?? '')) body.cliente = nome || null
        if (tipoSel) {
          body.serviceTypeId = tipoSel.id
          if (tipoSel.nome !== editing.tipo && editing.titulo === editing.tipo) body.titulo = tipoSel.nome
        }
        const r = await api<EventWriteResponse>(`/api/events/${editing.id}`, { method: 'PATCH', body })
        if (r.googleSync === 'falhou') {
          toast({
            icon: <Warning size={18} weight="fill" />,
            title: 'Salvo no PearChat, mas não foi possível enviar ao Google',
            text: `${nome || 'Cliente sem nome'} · ${diaCurto}, ${hora}`,
          })
        } else {
          toast({
            icon: <PencilSimple size={18} weight="fill" />,
            title: 'Agendamento atualizado',
            text: `${nome || 'Cliente sem nome'} · ${diaCurto}, ${hora}`,
          })
        }
        setEditing(null)
        setFocusId(null)
        setCliente('')
        setHora('')
        const t0 = tipos[0] as ServiceTypeDto | undefined
        if (t0) {
          setTipoId(t0.id)
          setDuracao(t0.duracaoMin)
        }
        emitAgendaChanged()
        return
      }
      const tipoSel = tipos.find((t) => t.id === tipoId)
      const r = await api<EventWriteResponse>('/api/events', {
        method: 'POST',
        body: {
          inicio: spInstant(selDate, hora),
          duracaoMin: duracao,
          ...(tipoSel ? { serviceTypeId: tipoSel.id } : { tipo: 'Atendimento' }),
          cliente: nome || null,
        },
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
          // Só afirma o envio quando houve sincronização de verdade (no modo de demonstração não há).
          text: `${nome || 'Cliente sem nome'} · ${diaCurto}, ${hora}${r.googleSync === 'ok' ? ' · enviado ao Google Agenda' : ''}`,
        })
      }
      setCliente('')
      setHora('')
      emitAgendaChanged()
    } catch (e) {
      toast({
        icon: <Warning size={18} weight="fill" />,
        title: editing ? 'Não foi possível salvar o agendamento' : 'Não foi possível agendar',
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
        toast({
          icon: <Trash size={18} weight="fill" />,
          title: 'Agendamento excluído',
          text: r.googleSync === 'ok' ? 'Ele também sai do Google Agenda' : undefined,
        })
      }
      if (editing?.id === id) cancelEdit()
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

  const confirmarManual = async (ev: EventDto) => {
    try {
      await api<EventWriteResponse>(`/api/events/${ev.id}`, { method: 'PATCH', body: { confirmacao: 'confirmado' } })
      toast({ icon: <CalendarCheck size={18} weight="fill" />, title: 'Marcado como confirmado', text: `${ev.cliente ?? 'Cliente sem nome'} · ${shortLabel(toSp(ev.inicio).date, today)}, ${toSp(ev.inicio).hm}` })
      emitAgendaChanged()
      void week.reload()
    } catch (e) {
      toast({ icon: <Warning size={18} weight="fill" />, title: 'Não foi possível confirmar', text: e instanceof Error ? e.message : 'Tente novamente em instantes.' })
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
      {!gerir && (!cal.conectado || reconectar || (cal.demo && cal.googleConfigurado)) ? null : !cal.conectado ? (
        <Banner
          tone="info"
          text="Você está usando a agenda do PearChat. Conecte o Google Agenda para sincronizar seus compromissos."
          action="Conectar Google Agenda"
          onAction={() => onConnectGoogle?.()}
        />
      ) : reconectar ? (
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
        activeEventId={editing?.id ?? focusId}
        onPickEvent={(i, ev) => {
          setSelIdx(i)
          setFocusId(ev.id)
        }}
        onEditEvent={(ev, i) => {
          setSelIdx(i)
          startEdit(ev)
        }}
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
          setFocusId(null)
        }}
        onPickSlot={(i, h) => {
          setSelIdx(i)
          setHora(h)
          setFocusId(null)
        }}
      />

      <div className="flex min-h-0 flex-col gap-3.5 overflow-y-auto max-[899px]:overflow-visible">
        <DayCard title={longLabel(selDate, today)} events={eventsByDate.get(selDate) ?? []}
          agentName={agentName}
          activeEventId={editing?.id ?? focusId}
          onEdit={startEdit}
          onDelete={excluir}
          onConfirm={(ev) => void confirmarManual(ev)}
        />
        {editorOpen ? (
          <ServiceTypeEditor tipos={tipos} onCancel={() => setEditorOpen(false)} onSaved={tiposSalvos} />
        ) : (
          <NewBooking
            editing={editing}
            cliente={cliente}
            onCliente={setCliente}
            tipos={tipos}
            tipoId={tipoId}
            onTipoId={changeTipo}
            tipoLegado={editing && !tipoId ? editing.tipo : null}
            duracao={duracao}
            onDuracao={(m) => {
              setDuracao(m)
              setHora(editing ? hora : '')
            }}
            onEditTipos={gerir ? () => setEditorOpen(true) : undefined}
            date={selDate}
            onDate={(d) => {
              goToDate(d)
              setHora('')
            }}
            diaCurto={diaCurto}
            horarios={horariosLivres}
            loadingFree={free.loading}
            freeError={free.error}
            hora={hora}
            onHora={setHora}
            saving={saving}
            onSubmit={() => void agendar()}
            onCancelEdit={cancelEdit}
          />
        )}
        {gerir && (
        <Preferences
          duracao={cal.duracaoPadraoMin}
          onDuracao={(d) => void patch({ duracaoPadraoMin: d })}
          lembretes={cal.lembretes}
          onToggleLembrete={toggleLembrete}
          pedirConfirmacao={cal.pedirConfirmacao}
          onPedirConfirmacao={(on) => void patch({ pedirConfirmacao: on })}
          tiposCount={tipos.length}
          onEditTipos={() => setEditorOpen(true)}
          oficial={wa.provider === 'oficial'}
          conectado={cal.conectado}
          email={cal.email || 'Google'}
          demo={cal.demo}
          disconnecting={disconnecting}
          onDisconnect={() => void desconectar()}
        />
        )}
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

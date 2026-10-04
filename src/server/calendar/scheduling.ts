import type { Event, ServiceType } from '@prisma/client'
import { db } from '@/lib/db'
import { findOverlappingTx, withBookingLock } from '@/app/api/events/_booking'
import { addDaysStr, isDateInWindow, loadBusy, slotsForDay, spToday } from '@/server/booking/availability'
import { deleteEvent, insertEvent, updateEvent } from '@/server/calendar/google'
import { invalidateGoogleCache } from '@/server/calendar/live'
import { destinoOf, eventDescription, getConnection, isRealConnection, logGoogleFailure } from '@/server/calendar/service'
import { addMin, isValidDateStr, parseInstant, spToDate, toSpHM } from '@/server/calendar/time'
import { displayName, logError, norm, spParts, spStartOfDay } from '@/server/engine/util'
import { emitToWorkspace } from '@/server/realtime/emit'

// Núcleo do agendamento feito pela IA (e reutilizável por qualquer outro fluxo): consulta de horários, criação, remarcação e
// cancelamento. Sempre no escopo do workspace e do contato da conversa. As regras de disponibilidade são as do link público
// (booking/availability): expediente 08-18 h, passo de 30 min, antecedência mínima, eventos locais ativos + Google.
// Escritas sempre dentro do lock da agenda (withBookingLock), com a checagem de conflito repetida lá dentro.

export const DIAS_SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

export const MAX_IA_POR_DIA = 2
export const MAX_FUTUROS_POR_CONTATO = 3
const BUSCA_PROXIMOS_DIAS = 14

export type Fail = { ok: false; codigo: string; erro: string; alternativas?: Alternativas }
export type Alternativas = { mesmoDia: string[]; proximosDias: { data: string; diaSemana: string; horarios: string[] }[] }

const fail = (codigo: string, erro: string, alternativas?: Alternativas): Fail => ({ ok: false, codigo, erro, ...(alternativas ? { alternativas } : {}) })

// ---- formatação ----

export const diaSemanaOf = (date: string): string => DIAS_SEMANA[new Date(`${date}T00:00:00Z`).getUTCDay()] ?? ''

const hm2 = (d: Date): string => toSpHM(d)

/** "segunda-feira, 5 de outubro, às 15:00" (fuso de São Paulo). */
export function quandoExtenso(inicio: Date): string {
  const p = spParts(inicio)
  const [, mm, dd] = p.ymd.split('-')
  return `${DIAS_SEMANA[p.dow]}, ${Number(dd)} de ${MESES[Number(mm) - 1]}, às ${hm2(inicio)}`
}

/** "2026-10-05T15:00" (horário local de São Paulo, sem fuso). */
export const localIso = (d: Date): string => `${spParts(d).ymd}T${hm2(d)}`

/** ISO local de São Paulo ("2026-10-05T15:00", com ou sem segundos) ou ISO com fuso. null se inválido. */
export function parseLocalInstant(s: string): Date | null {
  const t = s.trim()
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(t)
  if (m) {
    if (!isValidDateStr(m[1]) || Number(m[2]) > 23 || Number(m[3]) > 59) return null
    return spToDate(m[1], `${m[2]}:${m[3]}`)
  }
  return /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/.test(t) ? parseInstant(t) : null
}

// ---- serviços e janela ----

export async function listServices(workspaceId: string): Promise<ServiceType[]> {
  return db.serviceType.findMany({ where: { workspaceId, ativo: true }, orderBy: [{ ordem: 'asc' }, { createdAt: 'asc' }] })
}

/** Resolve o nome dito pelo modelo/cliente para um serviço ativo (sem acento, sem caixa; aceita nome parcial único). */
export async function resolveService(
  workspaceId: string,
  nome: string,
): Promise<{ ok: true; st: ServiceType } | { ok: false; codigo: string; erro: string; servicos: string[] }> {
  const all = await listServices(workspaceId)
  const nomes = all.map((s) => s.nome)
  const q = norm(nome).replace(/\s+/g, ' ').trim()
  if (!q) return { ok: false, codigo: 'SERVICO_INVALIDO', erro: 'Informe o serviço.', servicos: nomes }
  const exact = all.filter((s) => norm(s.nome).trim() === q)
  if (exact.length === 1) return { ok: true, st: exact[0] }
  const part = all.filter((s) => norm(s.nome).includes(q) || q.includes(norm(s.nome).trim()))
  if (part.length === 1) return { ok: true, st: part[0] }
  if (part.length > 1) return { ok: false, codigo: 'SERVICO_AMBIGUO', erro: `Mais de um serviço combina com "${nome}". Pergunte ao cliente qual deles.`, servicos: part.map((s) => s.nome) }
  return { ok: false, codigo: 'SERVICO_INEXISTENTE', erro: `Não existe o serviço "${nome}" neste negócio. Ofereça só os da lista.`, servicos: nomes }
}

type Cfg = { antecedenciaMin: number; diasAFrente: number }

async function loadCfg(workspaceId: string): Promise<Cfg> {
  const ws = await db.workspace.findUnique({ where: { id: workspaceId }, select: { bookingAntecedenciaMin: true, bookingDiasAFrente: true } })
  return { antecedenciaMin: ws?.bookingAntecedenciaMin ?? 120, diasAFrente: ws?.bookingDiasAFrente ?? 30 }
}

/** Horários livres de um dia para o serviço, ou o motivo de não haver (data inválida, passada, longe demais). */
export async function slotsOfDay(
  workspaceId: string,
  st: { duracaoMin: number },
  date: string,
  now: Date,
  opts: { ignoreEventId?: string; cfg?: Cfg } = {},
): Promise<{ ok: true; horarios: string[] } | Fail> {
  const cfg = opts.cfg ?? (await loadCfg(workspaceId))
  if (!isValidDateStr(date)) return fail('DATA_INVALIDA', 'Data inválida. Use o formato AAAA-MM-DD.')
  if (date < spToday(now)) return fail('DATA_PASSADA', 'Essa data já passou. Escolha uma data a partir de hoje.')
  if (!isDateInWindow(date, cfg.diasAFrente, now)) return fail('FORA_DA_JANELA', `Só é possível agendar até ${cfg.diasAFrente} dias à frente.`)
  const from = spToDate(date, '00:00')
  const { busy } = await loadBusy(workspaceId, from, addMin(from, 24 * 60), opts.ignoreEventId)
  return { ok: true, horarios: slotsForDay(date, st.duracaoMin, busy, cfg.antecedenciaMin, now) }
}

/** Próximos dias (depois de `after`) que têm vaga, no máximo `n`, com até 6 horários cada. */
export async function nextDaysWithSlots(
  workspaceId: string,
  st: { duracaoMin: number },
  after: string,
  now: Date,
  n = 2,
  opts: { ignoreEventId?: string; cfg?: Cfg; filtro?: (hm: string) => boolean } = {},
): Promise<{ data: string; diaSemana: string; horarios: string[] }[]> {
  const cfg = opts.cfg ?? (await loadCfg(workspaceId))
  const hoje = spToday(now)
  const last = addDaysStr(hoje, cfg.diasAFrente - 1)
  const start = after < hoje ? hoje : addDaysStr(after, 1)
  if (start > last) return []
  const end = addDaysStr(start, BUSCA_PROXIMOS_DIAS - 1) < last ? addDaysStr(start, BUSCA_PROXIMOS_DIAS - 1) : last
  const { busy } = await loadBusy(workspaceId, spToDate(start, '00:00'), spToDate(addDaysStr(end, 1), '00:00'), opts.ignoreEventId)
  const out: { data: string; diaSemana: string; horarios: string[] }[] = []
  for (let d = start; d <= end && out.length < n; d = addDaysStr(d, 1)) {
    const hs = slotsForDay(d, st.duracaoMin, busy, cfg.antecedenciaMin, now).filter((h) => !opts.filtro || opts.filtro(h))
    if (hs.length > 0) out.push({ data: d, diaSemana: diaSemanaOf(d), horarios: hs.slice(0, 6) })
  }
  return out
}

async function alternativesFor(workspaceId: string, st: { duracaoMin: number }, date: string, now: Date, cfg: Cfg, ignoreEventId?: string): Promise<Alternativas> {
  const same = await slotsOfDay(workspaceId, st, date, now, { cfg, ignoreEventId })
  return {
    mesmoDia: same.ok ? same.horarios.slice(0, 6) : [],
    proximosDias: await nextDaysWithSlots(workspaceId, st, date, now, 2, { cfg, ignoreEventId }),
  }
}

// ---- eventos do contato ----

export type OwnEvent = { id: string; servico: string; inicio: Date; duracaoMin: number }

/** Agendamentos FUTUROS e ativos do contato (e só dele). */
export async function futureEventsOf(workspaceId: string, contactId: string, now: Date): Promise<(OwnEvent & { confirmacao: string })[]> {
  const rows = await db.event.findMany({
    where: { workspaceId, contactId, status: 'ativo', inicio: { gt: now } },
    orderBy: { inicio: 'asc' },
    take: 10,
    include: { serviceType: { select: { nome: true } } },
  })
  return rows.map((e) => ({ id: e.id, servico: e.serviceType?.nome ?? e.tipo, inicio: e.inicio, duracaoMin: e.duracaoMin, confirmacao: e.confirmacao }))
}

// ---- Google (melhor esforço: falha nunca derruba a operação local) ----

type GoogleStatus = 'ok' | 'falhou' | 'desconectado'

async function googleInsert(workspaceId: string, ev: Event, contact: { nome: string; telefone: string | null }): Promise<GoogleStatus> {
  const conn = await getConnection(workspaceId)
  if (!conn || !isRealConnection(conn)) return 'desconectado'
  const destino = destinoOf(conn)
  if (!destino) return 'falhou'
  try {
    const googleEventId = await insertEvent(workspaceId, destino, {
      titulo: ev.titulo,
      descricao: [eventDescription(contact), 'Agendado pela IA'].join('\n'),
      inicio: ev.inicio,
      fim: addMin(ev.inicio, ev.duracaoMin),
    })
    await db.event.update({ where: { id: ev.id }, data: { googleEventId, googleCalendarId: destino } })
    return 'ok'
  } catch (err) {
    logGoogleFailure('insertEvent (IA)', err)
    return 'falhou'
  }
}

async function googleUpdate(workspaceId: string, ev: Event, contact: { nome: string; telefone: string | null }): Promise<GoogleStatus> {
  if (!ev.googleEventId) return 'desconectado'
  const conn = await getConnection(workspaceId)
  const destino = conn && isRealConnection(conn) ? (ev.googleCalendarId ?? destinoOf(conn)) : null
  if (!destino) return 'desconectado'
  try {
    await updateEvent(workspaceId, destino, ev.googleEventId, {
      titulo: ev.titulo,
      descricao: [eventDescription(contact), 'Agendado pela IA'].join('\n'),
      inicio: ev.inicio,
      fim: addMin(ev.inicio, ev.duracaoMin),
    })
    return 'ok'
  } catch (err) {
    logGoogleFailure('updateEvent (IA)', err)
    return 'falhou'
  }
}

async function googleRemove(workspaceId: string, ev: Event): Promise<GoogleStatus> {
  if (!ev.googleEventId) return 'desconectado'
  const conn = await getConnection(workspaceId)
  const destino = conn && isRealConnection(conn) ? (ev.googleCalendarId ?? destinoOf(conn)) : null
  if (!destino) return 'desconectado'
  try {
    await deleteEvent(workspaceId, destino, ev.googleEventId)
    return 'ok'
  } catch (err) {
    logGoogleFailure('deleteEvent (IA)', err)
    return 'falhou'
  }
}

type AgendaAction = 'criado' | 'remarcado' | 'cancelado'

function announce(workspaceId: string, acao: AgendaAction, cliente: string, inicio: Date): void {
  try {
    emitToWorkspace(workspaceId, 'agenda.updated', { workspaceId, ia: { acao, cliente, inicio: inicio.toISOString() } })
  } catch (e) {
    logError('scheduling', 'aviso de agenda', e)
  }
}

// ---- criar ----

export type CreateOk = { ok: true; event: Event; jaExistia: boolean; google: GoogleStatus; simulado?: boolean }

/** Nome informado pelo cliente, limpo (sem links, sem caracteres de controle, curto). null se não serve. */
export function cleanPersonName(raw: string | undefined): string | null {
  if (!raw) return null
  const n = raw.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮]/g, ' ').replace(/\s+/g, ' ').trim()
  if (n.length < 2 || n.length > 60) return null
  if (/https?:\/\/|www\.|@|\d{4,}/i.test(n)) return null
  return n
}

export async function createIaBooking(i: {
  workspaceId: string
  /** null só no "Testar o agente" (sem conversa): exige dryRun. */
  contactId: string | null
  st: ServiceType
  inicio: Date
  nome?: string
  now: Date
  dryRun?: boolean
}): Promise<CreateOk | Fail> {
  const { workspaceId, contactId, st, inicio, now } = i
  const cfg = await loadCfg(workspaceId)
  const date = spParts(inicio).ymd
  const hm = hm2(inicio)
  if (inicio.getTime() <= now.getTime()) return fail('DATA_PASSADA', 'Esse horário já passou. Escolha um horário futuro.')

  // Repetição da mesma chamada (o modelo tentou de novo): devolve o que já existe, sem duplicar nem acusar conflito consigo mesmo.
  if (contactId) {
    const same = await db.event.findFirst({ where: { workspaceId, contactId, status: 'ativo', inicio } })
    if (same) return { ok: true, event: same, jaExistia: true, google: same.googleEventId ? 'ok' : 'desconectado' }
  }

  const slots = await slotsOfDay(workspaceId, st, date, now, { cfg })
  if (!slots.ok) return slots
  if (!slots.horarios.includes(hm)) {
    const alt = await alternativesFor(workspaceId, st, date, now, cfg)
    const naGrade = slotsForDay(date, st.duracaoMin, [], cfg.antecedenciaMin, now)
    if (naGrade.includes(hm)) return fail('CONFLITO', 'Esse horário acabou de ficar ocupado. Ofereça uma das alternativas.', alt)
    const semAntecedencia = slotsForDay(date, st.duracaoMin, [], 0, now)
    if (semAntecedencia.includes(hm)) return fail('ANTECEDENCIA_MINIMA', `Precisa de pelo menos ${cfg.antecedenciaMin} minutos de antecedência. Ofereça uma das alternativas.`, alt)
    return fail('FORA_DO_EXPEDIENTE', 'Horário fora do expediente (08:00 às 18:00, de 30 em 30 minutos). Ofereça uma das alternativas.', alt)
  }

  type Outcome =
    | { kind: 'ok'; event: Event; jaExistia: boolean; contact: { nome: string; telefone: string | null } }
    | { kind: 'fail'; f: Fail }
    | { kind: 'dry'; contact: { nome: string; telefone: string | null } }

  const outcome: Outcome = await withBookingLock(workspaceId, async (tx): Promise<Outcome> => {
    if (!contactId) {
      return i.dryRun
        ? ({ kind: 'dry', contact: { nome: '', telefone: null } } as const)
        : { kind: 'fail', f: fail('CONTATO_INVALIDO', 'Contato da conversa não encontrado.') }
    }
    const contact = await tx.contact.findFirst({ where: { id: contactId, workspaceId } })
    if (!contact) return { kind: 'fail', f: fail('CONTATO_INVALIDO', 'Contato da conversa não encontrado.') }

    // Repetição da mesma chamada (modelo tentou de novo): devolve o que já existe, sem duplicar.
    const same = await tx.event.findFirst({ where: { workspaceId, contactId, status: 'ativo', inicio } })
    if (same) return { kind: 'ok', event: same, jaExistia: true, contact }

    const [first] = await findOverlappingTx(tx, workspaceId, inicio, addMin(inicio, st.duracaoMin))
    if (first) return { kind: 'fail', f: fail('CONFLITO', 'Esse horário acabou de ser ocupado por outro cliente. Ofereça uma das alternativas.', await alternativesFor(workspaceId, st, date, now, cfg)) }

    const hojeIa = await tx.event.count({ where: { workspaceId, contactId, origem: 'IA', createdAt: { gte: spStartOfDay(now) } } })
    if (hojeIa >= MAX_IA_POR_DIA) return { kind: 'fail', f: fail('LIMITE_DIARIO', 'Limite de agendamentos pela IA para este cliente hoje. Diga que a equipe confirma o horário.') }
    const futuros = await tx.event.count({ where: { workspaceId, contactId, status: 'ativo', inicio: { gt: now } } })
    if (futuros >= MAX_FUTUROS_POR_CONTATO) return { kind: 'fail', f: fail('LIMITE_FUTUROS', 'O cliente já tem vários agendamentos futuros. Diga que a equipe cuida de um novo horário.') }

    if (i.dryRun) return { kind: 'dry', contact }

    // O nome só é preenchido quando o contato ainda não tem nome de verdade (nunca sobrescreve o que o dono tem).
    let nomeContato = contact.nome
    const novoNome = cleanPersonName(i.nome)
    if (novoNome && !displayName(contact.nome, contact)) {
      await tx.contact.update({ where: { id: contact.id }, data: { nome: novoNome } })
      nomeContato = novoNome
    }
    const event = await tx.event.create({
      data: { workspaceId, contactId, inicio, duracaoMin: st.duracaoMin, serviceTypeId: st.id, titulo: st.nome, tipo: st.nome, origem: 'IA' },
    })
    return { kind: 'ok', event, jaExistia: false, contact: { nome: nomeContato, telefone: contact.telefone } }
  })

  if (outcome.kind === 'fail') return outcome.f
  if (outcome.kind === 'dry') return { ok: true, simulado: true, jaExistia: false, google: 'desconectado', event: { id: 'simulado', inicio, duracaoMin: st.duracaoMin } as Event }
  if (outcome.jaExistia) return { ok: true, event: outcome.event, jaExistia: true, google: outcome.event.googleEventId ? 'ok' : 'desconectado' }
  const google = await googleInsert(workspaceId, outcome.event, outcome.contact)
  invalidateGoogleCache(workspaceId)
  announce(workspaceId, 'criado', outcome.contact.nome, inicio)
  return { ok: true, event: outcome.event, jaExistia: false, google }
}

// ---- remarcar / cancelar ----

async function ownEvent(workspaceId: string, contactId: string, eventId: string, withCancelled = false) {
  return db.event.findFirst({
    where: { id: eventId, workspaceId, contactId, ...(withCancelled ? {} : { status: 'ativo' }) },
    include: { contact: { select: { nome: true, telefone: true } }, serviceType: true },
  })
}

export type RescheduleOk = { ok: true; event: Event; google: GoogleStatus; simulado?: boolean }

export async function rescheduleIaBooking(i: {
  workspaceId: string
  contactId: string
  eventId: string
  novoInicio: Date
  now: Date
  dryRun?: boolean
}): Promise<RescheduleOk | Fail> {
  const { workspaceId, contactId, eventId, novoInicio, now } = i
  const cur = await ownEvent(workspaceId, contactId, eventId)
  if (!cur) return fail('NAO_ENCONTRADO', 'Agendamento não encontrado para este cliente. Consulte os agendamentos antes.')
  if (cur.inicio.getTime() <= now.getTime()) return fail('JA_PASSOU', 'Esse agendamento já começou ou passou; não dá para remarcar. Diga que a equipe cuida disso.')
  if (novoInicio.getTime() <= now.getTime()) return fail('DATA_PASSADA', 'Esse horário já passou. Escolha um horário futuro.')
  if (novoInicio.getTime() === cur.inicio.getTime()) return fail('MESMO_HORARIO', 'O agendamento já está nesse horário.')

  const cfg = await loadCfg(workspaceId)
  const st = { duracaoMin: cur.duracaoMin }
  const date = spParts(novoInicio).ymd
  const hm = hm2(novoInicio)
  const slots = await slotsOfDay(workspaceId, st, date, now, { cfg, ignoreEventId: cur.id })
  if (!slots.ok) return slots
  if (!slots.horarios.includes(hm)) {
    const alt = await alternativesFor(workspaceId, st, date, now, cfg, cur.id)
    const naGrade = slotsForDay(date, st.duracaoMin, [], cfg.antecedenciaMin, now)
    return naGrade.includes(hm)
      ? fail('CONFLITO', 'Esse horário está ocupado. Ofereça uma das alternativas.', alt)
      : fail('FORA_DO_EXPEDIENTE', 'Horário fora do expediente ou com antecedência insuficiente. Ofereça uma das alternativas.', alt)
  }

  const fim = addMin(novoInicio, cur.duracaoMin)
  const outcome = await withBookingLock(workspaceId, async (tx) => {
    const [first] = await findOverlappingTx(tx, workspaceId, novoInicio, fim, cur.id)
    if (first) return { kind: 'conflict' } as const
    const still = await tx.event.findFirst({ where: { id: cur.id, workspaceId, contactId, status: 'ativo' }, select: { id: true } })
    if (!still) return { kind: 'gone' } as const
    if (i.dryRun) return { kind: 'dry' } as const
    const row = await tx.event.update({ where: { id: cur.id }, data: { inicio: novoInicio, confirmacao: 'pendente', confirmadoEm: null } })
    // Lembretes já registrados valem para o horário antigo.
    await tx.eventReminder.deleteMany({ where: { eventId: cur.id } })
    return { kind: 'ok', row } as const
  })
  if (outcome.kind === 'conflict') return fail('CONFLITO', 'Esse horário acabou de ser ocupado. Ofereça uma das alternativas.', await alternativesFor(workspaceId, st, date, now, cfg, cur.id))
  if (outcome.kind === 'gone') return fail('NAO_ENCONTRADO', 'Agendamento não encontrado para este cliente.')
  if (outcome.kind === 'dry') return { ok: true, simulado: true, google: 'desconectado', event: { ...cur, inicio: novoInicio } }
  const google = await googleUpdate(workspaceId, outcome.row, cur.contact ?? { nome: '', telefone: null })
  invalidateGoogleCache(workspaceId)
  announce(workspaceId, 'remarcado', cur.contact?.nome ?? '', novoInicio)
  return { ok: true, event: outcome.row, google }
}

export type CancelOk = { ok: true; event: Event; google: GoogleStatus; jaCancelado: boolean; simulado?: boolean }

export async function cancelIaBooking(i: {
  workspaceId: string
  contactId: string
  eventId: string
  now: Date
  dryRun?: boolean
}): Promise<CancelOk | Fail> {
  const { workspaceId, contactId, eventId, now } = i
  const cur = await ownEvent(workspaceId, contactId, eventId, true)
  if (!cur) return fail('NAO_ENCONTRADO', 'Agendamento não encontrado para este cliente. Consulte os agendamentos antes.')
  if (cur.status === 'cancelado') return { ok: true, event: cur, google: 'desconectado', jaCancelado: true }
  if (cur.inicio.getTime() <= now.getTime()) return fail('JA_PASSOU', 'Esse agendamento já começou ou passou; não dá para cancelar. Diga que a equipe cuida disso.')
  if (i.dryRun) return { ok: true, event: cur, google: 'desconectado', jaCancelado: false, simulado: true }

  const done = await withBookingLock(workspaceId, (tx) =>
    tx.event.updateMany({
      where: { id: cur.id, workspaceId, contactId, status: 'ativo' },
      data: { status: 'cancelado', canceladoEm: now, canceladoPor: 'cliente' },
    }),
  )
  if (done.count === 0) return { ok: true, event: cur, google: 'desconectado', jaCancelado: true }
  // Sai do Google e perde o vínculo (a sincronização não deve tratar o evento como vivo).
  const google = await googleRemove(workspaceId, cur)
  if (cur.googleEventId) await db.event.update({ where: { id: cur.id }, data: { googleEventId: null, googleCalendarId: null } })
  invalidateGoogleCache(workspaceId)
  announce(workspaceId, 'cancelado', cur.contact?.nome ?? '', cur.inicio)
  return { ok: true, event: { ...cur, status: 'cancelado', canceladoEm: now, canceladoPor: 'cliente' }, google, jaCancelado: false }
}

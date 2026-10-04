import { db } from '@/lib/db'
import { withBookingLock, findOverlappingTx } from '@/app/api/events/_booking'
import { insertEvent } from '@/server/calendar/google'
import { invalidateGoogleCache } from '@/server/calendar/live'
import { destinoOf, eventDescription, getConnection, isRealConnection, logGoogleFailure } from '@/server/calendar/service'
import { addMin, spToDate } from '@/server/calendar/time'
import { phoneCandidates, normalizePhone } from '@/server/contacts/phone'
import { canSendFreeformTo } from '@/server/engine/freeform'
import { contactRef, ensureConversation, sendAndRecord } from '@/server/engine/outbound'
import { displayName, getConnected, logError, spParts, templateFirstName } from '@/server/engine/util'
import { emitToWorkspace } from '@/server/realtime/emit'
import { isDateInWindow, loadBusy, slotsForDay } from './availability'
import { signEventToken } from './security'

// Núcleo da página pública de agendamento. Nada aqui devolve dado de outros eventos ou de outros negócios.

export const MSG_CONFLITO_LINK = 'Esse horário acabou de ser reservado, escolha outro.'
export const MAX_POR_HORA_IP = 5
export const MAX_FUTUROS_POR_TELEFONE = 3
export const MAX_OBS = 200

export type PublicWorkspace = {
  id: string
  nome: string
  /** Tem logo cadastrada (a imagem sai de /api/public/booking/<slug>/logo). */
  temLogo: boolean
  mensagem: string | null
  antecedenciaMin: number
  diasAFrente: number
}

/** Negócio com link ativo. Slug inexistente, link desativado e negócio arquivado dão o MESMO resultado (null). */
export async function getPublicWorkspace(slug: string): Promise<PublicWorkspace | null> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length < 3 || slug.length > 40) return null
  const ws = await db.workspace.findUnique({
    where: { slug },
    select: {
      id: true,
      nome: true,
      bookingAtivo: true,
      bookingAntecedenciaMin: true,
      bookingDiasAFrente: true,
      bookingMensagem: true,
      logoUrl: true,
      arquivadoEm: true,
    },
  })
  if (!ws || !ws.bookingAtivo || ws.arquivadoEm) return null
  return { id: ws.id, nome: ws.nome, temLogo: !!ws.logoUrl, mensagem: ws.bookingMensagem, antecedenciaMin: ws.bookingAntecedenciaMin, diasAFrente: ws.bookingDiasAFrente }
}

export type PublicService = { id: string; nome: string; duracaoMin: number }

export const listPublicServices = (workspaceId: string): Promise<PublicService[]> =>
  db.serviceType.findMany({
    where: { workspaceId, ativo: true },
    orderBy: [{ ordem: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, nome: true, duracaoMin: true },
  })

// ---- limpeza de texto ----

// Controles, separadores de linha/parágrafo, marcas de direção (bidi) e invisíveis: nunca fazem parte de um nome.
const INVISIBLE_RANGES: ReadonlyArray<readonly [number, number]> = [[0, 31], [127, 159], [173, 173], [8203, 8207], [8232, 8238], [8288, 8303], [65279, 65279]]
const stripInvisible = (s: string): string =>
  Array.from(s, (ch) => {
    const c = ch.codePointAt(0) ?? 0
    return INVISIBLE_RANGES.some(([a, b]) => c >= a && c <= b) ? ' ' : ch
  }).join('')
const HAS_LINK = /https?:\/\/|www\.|\w\.(?:com|net|org|br|io|xyz|ru|cn)\b/i

export function cleanLine(s: string): string {
  return stripInvisible(s.normalize('NFC')).replace(/\s+/g, ' ').trim()
}

/** Observação: mantém quebras de linha simples como espaço (uma linha só). */
export const cleanNote = cleanLine

export const hasLink = (s: string): boolean => HAS_LINK.test(s)
export const lengthOf = (s: string): number => Array.from(s).length

// ---- criação ----

export type BookingInput = {
  workspace: PublicWorkspace
  serviceTypeId: string
  date: string
  hora: string
  nome: string
  telefoneRaw: string
  observacao: string | null
  ipHash: string
  telefoneHash: (e164: string) => string
  now?: Date
}

export type BookingResult =
  | { kind: 'ok'; resumo: BookingSummary; eventId: string }
  | { kind: 'conflict' }
  | { kind: 'limit' }
  | { kind: 'invalid'; message: string }

export type BookingSummary = {
  negocio: string
  servico: string
  duracaoMin: number
  inicio: string
  data: string
  hora: string
  icsToken: string
  whatsappUrl: string | null
}

const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']

export function diaLabel(inicio: Date): string {
  const p = spParts(inicio)
  const [, mm, dd] = p.ymd.split('-')
  return `${DIAS[p.dow]}, ${dd}/${mm}`
}

export const horaLabel = (d: Date): string => {
  const p = spParts(d)
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
}

export function confirmationText(args: { nome: string; telefone?: string | null; servico: string; inicio: Date; negocio: string }): string {
  const primeiro = templateFirstName(args.nome, { telefone: args.telefone })
  return `Olá, ${primeiro}! Seu horário de ${args.servico} está marcado para ${diaLabel(args.inicio)}, às ${horaLabel(args.inicio)}. — ${args.negocio}`
}

export async function createPublicBooking(input: BookingInput): Promise<BookingResult> {
  const { workspace: ws } = input
  const now = input.now ?? new Date()

  const st = await db.serviceType.findFirst({
    where: { id: input.serviceTypeId, workspaceId: ws.id, ativo: true },
    select: { id: true, nome: true, duracaoMin: true },
  })
  if (!st) return { kind: 'invalid', message: 'Esse serviço não está mais disponível. Escolha outro.' }

  const telefone = normalizePhone(input.telefoneRaw)
  if (!telefone) return { kind: 'invalid', message: 'Informe um WhatsApp válido, com DDD.' }

  if (!isDateInWindow(input.date, ws.diasAFrente, now)) return { kind: 'invalid', message: 'Esse dia não está disponível para agendamento.' }
  const inicio = spToDate(input.date, input.hora)
  const fim = addMin(inicio, st.duracaoMin)

  // Antecedência mínima, grade de horários e ocupação (locais + Google), as mesmas regras de GET /free.
  const dayStart = spToDate(input.date, '00:00')
  const { busy } = await loadBusy(ws.id, dayStart, addMin(dayStart, 24 * 60))
  const livres = slotsForDay(input.date, st.duracaoMin, busy, ws.antecedenciaMin, now)
  if (!livres.includes(input.hora)) {
    const naGrade = slotsForDay(input.date, st.duracaoMin, [], ws.antecedenciaMin, now)
    return naGrade.includes(input.hora) ? { kind: 'conflict' } : { kind: 'invalid', message: 'Esse horário não está disponível. Escolha outro.' }
  }

  const candidatos = phoneCandidates(input.telefoneRaw)
  const telHash = input.telefoneHash(telefone)
  const since = new Date(now.getTime() - 3_600_000)

  const outcome = await withBookingLock(ws.id, async (tx) => {
    // Limites de abuso dentro do lock do negócio: dez pedidos simultâneos não furam o teto.
    const [porIp, porTel] = await Promise.all([
      tx.bookingAttempt.count({ where: { workspaceId: ws.id, ipHash: input.ipHash, createdAt: { gte: since } } }),
      tx.bookingAttempt.count({ where: { workspaceId: ws.id, telefoneHash: telHash, createdAt: { gte: since } } }),
    ])
    if (porIp >= MAX_POR_HORA_IP || porTel >= MAX_POR_HORA_IP) return { kind: 'limit' } as const

    const [first] = await findOverlappingTx(tx, ws.id, inicio, fim)
    if (first) return { kind: 'conflict' } as const

    const existentes = await tx.contact.findMany({
      where: { workspaceId: ws.id, telefone: { in: candidatos } },
      select: { id: true, nome: true, notas: true, optOut: true },
      orderBy: { createdAt: 'asc' },
    })
    if (existentes.length > 0) {
      const futuros = await tx.event.count({
        where: { workspaceId: ws.id, status: 'ativo', contactId: { in: existentes.map((c) => c.id) }, inicio: { gt: now } },
      })
      if (futuros >= MAX_FUTUROS_POR_TELEFONE) return { kind: 'limit' } as const
    }

    const nota = input.observacao
      ? `[Agendamento pelo link, ${diaLabel(inicio)} ${horaLabel(inicio)}] ${input.observacao}`
      : null
    let contact = existentes[0]
    if (contact) {
      // Nunca sobrescreve o nome que o dono já tem; a observação entra nas notas.
      if (nota) {
        const notas = `${contact.notas ? `${contact.notas}\n` : ''}${nota}`.slice(0, 4000)
        await tx.contact.update({ where: { id: contact.id }, data: { notas } })
        contact = { ...contact, notas }
      }
    } else {
      contact = await tx.contact.create({
        data: { workspaceId: ws.id, nome: input.nome, telefone, tags: [], notas: nota },
        select: { id: true, nome: true, notas: true, optOut: true },
      })
    }

    const row = await tx.event.create({
      data: {
        workspaceId: ws.id,
        contactId: contact.id,
        inicio,
        duracaoMin: st.duracaoMin,
        serviceTypeId: st.id,
        titulo: st.nome,
        tipo: st.nome,
        origem: 'MANUAL',
        canal: 'link',
      },
      select: { id: true },
    })
    await tx.bookingAttempt.create({ data: { workspaceId: ws.id, ipHash: input.ipHash, telefoneHash: telHash } })
    // Faxina oportunista dos registros de limite (valem 1 h; guardamos 2 dias).
    await tx.bookingAttempt.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 2 * 86_400_000) } } })
    return { kind: 'ok', eventId: row.id, contact } as const
  })

  if (outcome.kind !== 'ok') return outcome
  const { eventId, contact } = outcome
  // Nome para falar com a pessoa: o do contato, ou o digitado quando o do contato é só um número.
  const contactNome = displayName(contact.nome, { telefone }) ? contact.nome : input.nome

  // Google: mesmo caminho do agendamento manual; falha não bloqueia.
  const conn = await getConnection(ws.id)
  if (conn && isRealConnection(conn)) {
    const destino = destinoOf(conn)
    if (destino) {
      try {
        const descricao = [eventDescription({ nome: contactNome, telefone }), 'Agendado pelo link', input.observacao ? `Observação: ${input.observacao}` : null]
          .filter(Boolean)
          .join('\n')
        const googleEventId = await insertEvent(ws.id, destino, { titulo: st.nome, descricao, inicio, fim })
        await db.event.update({ where: { id: eventId }, data: { googleEventId, googleCalendarId: destino } })
      } catch (err) {
        logGoogleFailure('insertEvent (link público)', err)
      }
    }
  }
  invalidateGoogleCache(ws.id)

  // Confirmação no WhatsApp do cliente (só se o número do negócio está conectado e o contato aceita mensagens).
  let numero: string | null = null
  try {
    const session = await getConnected(ws.id)
    if (session) {
      const wa = await db.whatsAppSession.findUnique({ where: { workspaceId: ws.id }, select: { numero: true } })
      const digits = (wa?.numero ?? '').replace(/\D/g, '')
      numero = digits.length >= 10 && digits.length <= 15 ? digits : null
      if (!contact.optOut) {
        const full = await db.contact.findUniqueOrThrow({ where: { id: contact.id }, select: { id: true, nome: true, waUserId: true, telefone: true } })
        const to = contactRef(full)
        if (await canSendFreeformTo(session, to)) {
          const conv = await ensureConversation(ws.id, full.id)
          await sendAndRecord({
            session,
            conversationId: conv.id,
            to,
            author: 'IA',
            content: { kind: 'text', text: confirmationText({ nome: contactNome, telefone: full.telefone, servico: st.nome, inicio, negocio: ws.nome }) },
            countAtendimento: true,
          })
        }
      }
    }
  } catch (err) {
    // A confirmação é cortesia: o agendamento já está salvo.
    logError('booking', `confirmação por WhatsApp falhou (negócio ${ws.id})`, err)
  }

  emitToWorkspace(ws.id, 'agenda.updated', { workspaceId: ws.id, link: { cliente: contactNome, inicio: inicio.toISOString() } })

  return {
    kind: 'ok',
    eventId,
    resumo: {
      negocio: ws.nome,
      servico: st.nome,
      duracaoMin: st.duracaoMin,
      inicio: inicio.toISOString(),
      data: input.date,
      hora: input.hora,
      icsToken: signEventToken(eventId),
      whatsappUrl: numero ? `https://wa.me/${numero}` : null,
    },
  }
}

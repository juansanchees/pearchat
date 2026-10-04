import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { badRequest, readJson, sessionWorkspaceId, unauthorized } from '@/server/messages/api'
import { insertEvent } from '@/server/calendar/google'
import { googleEventsInRange, invalidateGoogleCache } from '@/server/calendar/live'
import {
  MAX_DURACAO_MIN,
  MAX_EVENT_MS,
  apiError,
  conflictResponse,
  destinoOf,
  eventDescription,
  eventInclude,
  getConnection,
  isRealConnection,
  logGoogleFailure,
  toEventDto,
} from '@/server/calendar/service'
import { addMin, parseInstant } from '@/server/calendar/time'
import { findOverlappingTx, resolveContactTx, withBookingLock } from './_booking'
import type { EventListResponse, EventWriteResponse, GoogleSyncStatus } from '@/server/calendar/types'

export const dynamic = 'force-dynamic'

const MAX_RANGE_MS = 62 * 24 * 60 * 60 * 1000

const instant = z.string().transform((s, ctx) => {
  const d = parseInstant(s)
  if (!d) ctx.addIssue({ code: 'custom', message: 'Data inválida' })
  return d ?? new Date(NaN)
})

const querySchema = z.object({ from: instant, to: instant })

/**
 * GET /api/events?from=&to=
 * from/to: ISO 8601 com offset/Z ou "YYYY-MM-DD" (meia-noite de São Paulo). Intervalo máx. 62 dias.
 * Devolve eventos que se sobrepõem a [from, to). Resposta: EventListResponse.
 */
export async function GET(req: NextRequest) {
  const workspaceId = await sessionWorkspaceId()
  if (!workspaceId) return unauthorized()

  const sp = req.nextUrl.searchParams
  const parsed = querySchema.safeParse({ from: sp.get('from') ?? '', to: sp.get('to') ?? '' })
  if (!parsed.success) return badRequest('Parâmetros inválidos: informe from e to')
  const { from, to } = parsed.data
  if (to <= from || to.getTime() - from.getTime() > MAX_RANGE_MS) {
    return badRequest('Intervalo inválido (máximo 62 dias)')
  }

  const rows = await db.event.findMany({
    where: {
      workspaceId,
      status: 'ativo',
      inicio: { gte: new Date(from.getTime() - MAX_EVENT_MS), lt: to },
    },
    include: eventInclude,
    orderBy: { inicio: 'asc' },
  })
  const locais = rows.filter((r) => addMin(r.inicio, r.duracaoMin) > from)
  const eventos = locais.map(toEventDto)

  // Compromissos das agendas selecionadas do Google (somente leitura), sem duplicar os do PearChat.
  const conn = await getConnection(workspaceId)
  let google: EventListResponse['google'] = { status: 'desconectado', sincronizadoEm: null }
  if (conn && isRealConnection(conn)) {
    const ids = new Set(rows.flatMap((r) => (r.googleEventId ? [r.googleEventId] : [])))
    const live = await googleEventsInRange(workspaceId, conn, from, to, ids)
    eventos.push(...live.eventos)
    google = { status: live.status, sincronizadoEm: live.sincronizadoEm }
  }
  eventos.sort((a, b) => (a.inicio < b.inicio ? -1 : a.inicio > b.inicio ? 1 : 0))
  return NextResponse.json({ eventos, google } satisfies EventListResponse)
}

// Início no passado (com 5 min de tolerância) ou em ano absurdo não é agendamento: 422/400 com mensagem.
const PAST_TOLERANCE_MS = 5 * 60_000

const bodySchema = z
  .object({
    inicio: z
      .string()
      .datetime({ offset: true })
      .refine((s) => {
        const y = new Date(s).getUTCFullYear()
        return y >= 2000 && y <= 2100
      }, 'Data fora do intervalo permitido'),
    duracaoMin: z.number().int().min(5).max(MAX_DURACAO_MIN).optional(),
    titulo: z.string().trim().min(1).max(120).optional(),
    tipo: z.string().trim().min(1).max(60).optional(),
    serviceTypeId: z.string().min(1).nullish(),
    cliente: z.string().trim().max(120).nullish(),
    contactId: z.string().min(1).nullish(),
  })
  .strict()

/**
 * POST /api/events  { inicio, duracaoMin, titulo?, tipo, cliente? | contactId? }
 * 201 EventWriteResponse | 400 | 401 | 409 CONFLITO | 422 CONTATO_INVALIDO.
 */
export async function POST(req: NextRequest) {
  const workspaceId = await sessionWorkspaceId()
  if (!workspaceId) return unauthorized()

  const json = await readJson(req)
  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) return badRequest('Dados do agendamento inválidos')
  const b = parsed.data
  if (!b.tipo && !b.serviceTypeId) return badRequest('Informe o tipo do agendamento')

  let st: { id: string; nome: string; duracaoMin: number } | null = null
  if (b.serviceTypeId) {
    st = await db.serviceType.findFirst({
      where: { id: b.serviceTypeId, workspaceId },
      select: { id: true, nome: true, duracaoMin: true },
    })
    if (!st) return apiError('TIPO_INVALIDO', 'Tipo de atendimento não encontrado.', 422)
  }
  const tipo = st?.nome ?? b.tipo ?? ''
  const conn0 = await getConnection(workspaceId)
  const duracaoMin = b.duracaoMin ?? st?.duracaoMin ?? conn0?.duracaoPadraoMin ?? 60

  const inicio = new Date(b.inicio)
  if (inicio.getTime() < Date.now() - PAST_TOLERANCE_MS) {
    return apiError('DATA_PASSADA', 'Esse horário já passou. Escolha um horário a partir de agora.', 422)
  }
  const fim = addMin(inicio, duracaoMin)

  const titulo = b.titulo ?? tipo
  // Checagem de conflito + criação numa transação com lock da agenda: dois pedidos simultâneos não duplicam o horário.
  const outcome = await withBookingLock(workspaceId, async (tx) => {
    const [first] = await findOverlappingTx(tx, workspaceId, inicio, fim)
    if (first) return { kind: 'conflict', row: first } as const
    const contact = await resolveContactTx(tx, workspaceId, b)
    if (!contact.ok) return { kind: 'badContact' } as const
    const row = await tx.event.create({
      data: {
        workspaceId,
        contactId: contact.id,
        inicio,
        duracaoMin,
        serviceTypeId: st?.id ?? null,
        titulo,
        tipo,
        origem: 'MANUAL',
      },
      include: eventInclude,
    })
    return { kind: 'created', row } as const
  })
  if (outcome.kind === 'conflict') return conflictResponse(toEventDto(outcome.row))
  if (outcome.kind === 'badContact') return apiError('CONTATO_INVALIDO', 'Contato não encontrado.', 422)
  const created = outcome.row

  let googleSync: GoogleSyncStatus = 'desconectado'
  let row = created
  const conn = await getConnection(workspaceId)
  if (conn && isRealConnection(conn)) {
    googleSync = 'falhou'
    const destino = destinoOf(conn)
    if (destino) {
      try {
        const googleEventId = await insertEvent(workspaceId, destino, {
          titulo,
          descricao: eventDescription(created.contact),
          inicio,
          fim,
        })
        row = await db.event.update({
          where: { id: created.id },
          data: { googleEventId, googleCalendarId: destino },
          include: eventInclude,
        })
        googleSync = 'ok'
      } catch (err) {
        logGoogleFailure('insertEvent', err)
      }
    }
  }

  invalidateGoogleCache(workspaceId)
  return NextResponse.json({ evento: toEventDto(row), googleSync } satisfies EventWriteResponse, {
    status: 201,
  })
}

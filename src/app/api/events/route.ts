import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { badRequest, sessionWorkspaceId, unauthorized } from '@/server/messages/api'
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
  findOverlapping,
  getConnection,
  isRealConnection,
  logGoogleFailure,
  resolveContactId,
  toEventDto,
} from '@/server/calendar/service'
import { addMin, parseInstant } from '@/server/calendar/time'
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

const bodySchema = z
  .object({
    inicio: z.string().datetime({ offset: true }),
    duracaoMin: z.number().int().min(5).max(MAX_DURACAO_MIN),
    titulo: z.string().trim().min(1).max(120).optional(),
    tipo: z.string().trim().min(1).max(60),
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

  const json: unknown = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) return badRequest('Dados do agendamento inválidos')
  const b = parsed.data

  const inicio = new Date(b.inicio)
  const fim = addMin(inicio, b.duracaoMin)

  const conflicts = await findOverlapping(workspaceId, inicio, fim)
  if (conflicts.length > 0) return conflictResponse(toEventDto(conflicts[0]))

  const contact = await resolveContactId(workspaceId, b)
  if (!contact.ok) return apiError('CONTATO_INVALIDO', 'Contato não encontrado.', 422)

  const titulo = b.titulo ?? b.tipo
  const created = await db.event.create({
    data: {
      workspaceId,
      contactId: contact.id,
      inicio,
      duracaoMin: b.duracaoMin,
      titulo,
      tipo: b.tipo,
      origem: 'MANUAL',
    },
    include: eventInclude,
  })

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

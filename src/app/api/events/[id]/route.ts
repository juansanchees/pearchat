import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import { badRequest, sessionWorkspaceId, unauthorized } from '@/server/messages/api'
import { deleteEvent, updateEvent } from '@/server/calendar/google'
import { invalidateGoogleCache } from '@/server/calendar/live'
import {
  MAX_DURACAO_MIN,
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
import { addMin } from '@/server/calendar/time'
import type { EventDeleteResponse, EventWriteResponse, GoogleSyncStatus } from '@/server/calendar/types'

export const dynamic = 'force-dynamic'

interface Ctx {
  params: { id: string }
}

const notFound = () => apiError('NAO_ENCONTRADO', 'Agendamento não encontrado.', 404)

const patchSchema = z
  .object({
    inicio: z.string().datetime({ offset: true }).optional(),
    duracaoMin: z.number().int().min(5).max(MAX_DURACAO_MIN).optional(),
    titulo: z.string().trim().min(1).max(120).optional(),
    tipo: z.string().trim().min(1).max(60).optional(),
    serviceTypeId: z.string().min(1).nullish(),
    cliente: z.string().trim().max(120).nullish(),
    contactId: z.string().min(1).nullish(),
  })
  .strict()

/**
 * PATCH /api/events/[id]  (todos os campos opcionais; `cliente: null`/"" remove o contato).
 * 200 EventWriteResponse | 400 | 401 | 404 | 409 CONFLITO | 422 CONTATO_INVALIDO.
 */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const workspaceId = await sessionWorkspaceId()
  if (!workspaceId) return unauthorized()

  const json: unknown = await req.json().catch(() => null)
  const parsed = patchSchema.safeParse(json)
  if (!parsed.success) return badRequest('Dados do agendamento inválidos')
  const b = parsed.data

  const current = await db.event.findFirst({ where: { id: params.id, workspaceId } })
  if (!current) return notFound()

  const inicio = b.inicio ? new Date(b.inicio) : current.inicio
  const duracaoMin = b.duracaoMin ?? current.duracaoMin
  const fim = addMin(inicio, duracaoMin)

  if (b.inicio !== undefined || b.duracaoMin !== undefined) {
    const conflicts = await findOverlapping(workspaceId, inicio, fim, current.id)
    if (conflicts.length > 0) return conflictResponse(toEventDto(conflicts[0]))
  }

  const data: Prisma.EventUncheckedUpdateInput = { inicio, duracaoMin }
  if (b.titulo !== undefined) data.titulo = b.titulo
  if (b.tipo !== undefined) data.tipo = b.tipo
  if (b.serviceTypeId === null) data.serviceTypeId = null
  else if (b.serviceTypeId) {
    const st = await db.serviceType.findFirst({
      where: { id: b.serviceTypeId, workspaceId },
      select: { id: true, nome: true },
    })
    if (!st) return apiError('TIPO_INVALIDO', 'Tipo de atendimento não encontrado.', 422)
    data.serviceTypeId = st.id
    data.tipo = st.nome
  }
  if (b.contactId !== undefined || b.cliente !== undefined) {
    const contact = await resolveContactId(workspaceId, b)
    if (!contact.ok) return apiError('CONTATO_INVALIDO', 'Contato não encontrado.', 422)
    data.contactId = contact.id
  }

  const updated = await db.event.update({ where: { id: current.id }, data, include: eventInclude })

  // Horário mudou: os lembretes já registrados não valem mais; recomeçam para o novo horário.
  if (inicio.getTime() !== current.inicio.getTime()) {
    await db.eventReminder.deleteMany({ where: { eventId: current.id } })
  }

  let googleSync: GoogleSyncStatus = 'desconectado'
  if (current.googleEventId) {
    const conn = await getConnection(workspaceId)
    const destino = conn && isRealConnection(conn) ? (current.googleCalendarId ?? destinoOf(conn)) : null
    if (destino) {
      googleSync = 'falhou'
      try {
        await updateEvent(workspaceId, destino, current.googleEventId, {
          titulo: updated.titulo,
          descricao: eventDescription(updated.contact),
          inicio,
          fim,
        })
        googleSync = 'ok'
      } catch (err) {
        logGoogleFailure('updateEvent', err)
      }
    }
  }

  invalidateGoogleCache(workspaceId)
  return NextResponse.json({ evento: toEventDto(updated), googleSync } satisfies EventWriteResponse)
}

/**
 * DELETE /api/events/[id] -> 200 EventDeleteResponse | 401 | 404.
 * Remove também do Google (best-effort, tolera 404/410) se o evento tiver googleEventId.
 * Eventos lidos do Google (ids "g:...") não existem aqui: 404.
 */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const workspaceId = await sessionWorkspaceId()
  if (!workspaceId) return unauthorized()

  const current = await db.event.findFirst({ where: { id: params.id, workspaceId } })
  if (!current) return notFound()

  let googleSync: GoogleSyncStatus = 'desconectado'
  if (current.googleEventId) {
    const conn = await getConnection(workspaceId)
    const destino = conn && isRealConnection(conn) ? (current.googleCalendarId ?? destinoOf(conn)) : null
    if (destino) {
      googleSync = 'falhou'
      try {
        await deleteEvent(workspaceId, destino, current.googleEventId)
        googleSync = 'ok'
      } catch (err) {
        logGoogleFailure('deleteEvent', err)
      }
    }
  }

  await db.event.delete({ where: { id: current.id } })
  invalidateGoogleCache(workspaceId)
  return NextResponse.json({ ok: true, googleSync } satisfies EventDeleteResponse)
}

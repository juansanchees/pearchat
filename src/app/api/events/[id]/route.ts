import { denyUnless } from '@/server/auth/guard'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import { badRequest, isValidId, sessionWorkspaceId, unauthorized } from '@/server/messages/api'
import { readJson } from '@/server/http/body'
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
import { findOverlappingTx, withBookingLock } from '../_booking'
import type { EventDeleteResponse, EventWriteResponse, GoogleSyncStatus } from '@/server/calendar/types'

export const dynamic = 'force-dynamic'

interface Ctx {
  params: { id: string }
}

const notFound = () => apiError('NAO_ENCONTRADO', 'Agendamento não encontrado.', 404)

const patchSchema = z
  .object({
    inicio: z
      .string()
      .datetime({ offset: true })
      .refine((s) => {
        const y = new Date(s).getUTCFullYear()
        return y >= 2000 && y <= 2100
      }, 'Data fora do intervalo permitido')
      .optional(),
    duracaoMin: z.number().int().min(5).max(MAX_DURACAO_MIN).optional(),
    titulo: z.string().trim().min(1).max(120).optional(),
    tipo: z.string().trim().min(1).max(60).optional(),
    serviceTypeId: z.string().min(1).nullish(),
    cliente: z.string().trim().max(120).nullish(),
    contactId: z.string().min(1).nullish(),
    // Confirmação marcada à mão pelo dono (ou desfeita).
    confirmacao: z.enum(['pendente', 'confirmado']).optional(),
  })
  .strict()

/**
 * PATCH /api/events/[id]  (todos os campos opcionais; `cliente: null`/"" remove o contato).
 * 200 EventWriteResponse | 400 | 401 | 404 | 409 CONFLITO | 422 CONTATO_INVALIDO.
 */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const deny = await denyUnless('agenda.use'); if (deny) return deny
  const workspaceId = await sessionWorkspaceId()
  if (!workspaceId) return unauthorized()
  if (!isValidId(params.id)) return notFound()

  const json = await readJson(req)
  const parsed = patchSchema.safeParse(json)
  if (!parsed.success) return badRequest('Dados do agendamento inválidos')
  const b = parsed.data

  const current = await db.event.findFirst({ where: { id: params.id, workspaceId, status: 'ativo' } })
  if (!current) return notFound()

  const inicio = b.inicio ? new Date(b.inicio) : current.inicio
  // Remarcar para o passado não faz sentido; editar título/cliente de um evento que já passou continua valendo.
  if (b.inicio && inicio.getTime() !== current.inicio.getTime() && inicio.getTime() < Date.now() - 5 * 60_000) {
    return apiError('DATA_PASSADA', 'Esse horário já passou. Escolha um horário a partir de agora.', 422)
  }
  const duracaoMin = b.duracaoMin ?? current.duracaoMin
  const fim = addMin(inicio, duracaoMin)

  if (b.inicio !== undefined || b.duracaoMin !== undefined) {
    const conflicts = await findOverlapping(workspaceId, inicio, fim, current.id)
    if (conflicts.length > 0) return conflictResponse(toEventDto(conflicts[0]))
  }

  const data: Prisma.EventUncheckedUpdateInput = { inicio, duracaoMin }
  if (inicio.getTime() !== current.inicio.getTime()) {
    // Outro horário: a confirmação anterior não vale mais.
    data.confirmacao = 'pendente'
    data.confirmadoEm = null
  }
  if (b.confirmacao !== undefined) {
    data.confirmacao = b.confirmacao
    data.confirmadoEm = b.confirmacao === 'confirmado' ? new Date() : null
  }
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

  // Remarcação: confere o conflito de novo DENTRO do lock da agenda e grava na mesma transação.
  const mustCheck = b.inicio !== undefined || b.duracaoMin !== undefined
  const outcome = await withBookingLock(workspaceId, async (tx) => {
    if (mustCheck) {
      const [first] = await findOverlappingTx(tx, workspaceId, inicio, fim, current.id)
      if (first) return { kind: 'conflict', row: first } as const
    }
    const row = await tx.event.updateMany({ where: { id: current.id, workspaceId }, data })
    if (row.count === 0) return { kind: 'gone' } as const
    return { kind: 'updated', row: await tx.event.findUniqueOrThrow({ where: { id: current.id }, include: eventInclude }) } as const
  })
  if (outcome.kind === 'conflict') return conflictResponse(toEventDto(outcome.row))
  if (outcome.kind === 'gone') return notFound()
  const updated = outcome.row

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
  const deny = await denyUnless('agenda.use'); if (deny) return deny
  const workspaceId = await sessionWorkspaceId()
  if (!workspaceId) return unauthorized()
  if (!isValidId(params.id)) return notFound()

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

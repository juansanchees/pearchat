import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import { badRequest, sessionWorkspaceId, unauthorized } from '@/server/messages/api'
import { invalidateGoogleCache } from '@/server/calendar/live'
import { readTokens, revokeToken } from '@/server/calendar/google'
import { apiError, getConnection, isRealConnection, parseCalendarios, toCalendarState } from '@/server/calendar/service'
import { LEMBRETES } from '@/server/calendar/types'

export const dynamic = 'force-dynamic'

/** GET /api/calendar -> CalendarStateDto (sem conexão: conectado=false e padrões da spec). */
export async function GET() {
  const workspaceId = await sessionWorkspaceId()
  if (!workspaceId) return unauthorized()
  return NextResponse.json(toCalendarState(await getConnection(workspaceId)))
}

const patchSchema = z
  .object({
    iaPodeAgendar: z.boolean().optional(),
    duracaoPadraoMin: z.union([z.literal(30), z.literal(60), z.literal(120)]).optional(),
    lembretes: z
      .array(z.enum(LEMBRETES))
      .max(LEMBRETES.length)
      .refine((a) => new Set(a).size === a.length)
      .optional(),
    /** Só altera `selecionado` de agendas já conhecidas (ids desconhecidos são ignorados). */
    calendarios: z.array(z.object({ id: z.string().min(1), selecionado: z.boolean() })).max(100).optional(),
    destinoId: z.string().min(1).optional(),
  })
  .strict()

/**
 * PATCH /api/calendar  (qualquer subconjunto de: iaPodeAgendar, duracaoPadraoMin 30|60|120,
 * lembretes ('24h'|'2h'|'30min')[], calendarios [{id,selecionado}], destinoId).
 * A agenda-destino fica sempre selecionada. 200 CalendarStateDto | 400 | 401 | 404 NAO_CONECTADO.
 */
export async function PATCH(req: NextRequest) {
  const workspaceId = await sessionWorkspaceId()
  if (!workspaceId) return unauthorized()

  const json: unknown = await req.json().catch(() => null)
  const parsed = patchSchema.safeParse(json)
  if (!parsed.success) return badRequest('Preferências inválidas')
  const b = parsed.data

  const conn = await getConnection(workspaceId)
  if (!conn) return apiError('NAO_CONECTADO', 'Google Agenda não conectado.', 404)

  const data: Prisma.CalendarConnectionUpdateInput = {}
  if (b.iaPodeAgendar !== undefined) data.iaPodeAgendar = b.iaPodeAgendar
  if (b.duracaoPadraoMin !== undefined) data.duracaoPadraoMin = b.duracaoPadraoMin
  if (b.lembretes !== undefined) data.lembretes = b.lembretes

  if (b.calendarios !== undefined || b.destinoId !== undefined) {
    const sel = new Map((b.calendarios ?? []).map((c) => [c.id, c.selecionado]))
    const list = parseCalendarios(conn.calendarios).map((c) => ({
      ...c,
      selecionado: sel.get(c.id) ?? c.selecionado,
    }))
    const destinoId = b.destinoId ?? conn.destinoId
    if (destinoId !== null && !list.some((c) => c.id === destinoId)) {
      return badRequest('Agenda de destino desconhecida')
    }
    data.calendarios = list.map((c) => (c.id === destinoId ? { ...c, selecionado: true } : c))
    data.destinoId = destinoId
  }

  const updated = await db.calendarConnection.update({ where: { workspaceId }, data })
  if (b.calendarios !== undefined || b.destinoId !== undefined) invalidateGoogleCache(workspaceId)
  return NextResponse.json(toCalendarState(updated))
}

/**
 * DELETE /api/calendar -> desconecta: revoga o token no Google (best-effort), apaga a conexão
 * (e os tokens). Eventos locais permanecem; o vínculo com o Google (googleEventId) é zerado.
 * 200 CalendarStateDto (já desconectado) | 401. Idempotente.
 */
export async function DELETE() {
  const workspaceId = await sessionWorkspaceId()
  if (!workspaceId) return unauthorized()
  const conn = await getConnection(workspaceId)
  if (isRealConnection(conn)) {
    const tokens = conn.tokens ? readTokens(conn.tokens) : null
    if (tokens) await revokeToken(tokens.refreshToken)
  }
  await db.$transaction([
    db.calendarConnection.deleteMany({ where: { workspaceId } }),
    db.event.updateMany({ where: { workspaceId }, data: { googleEventId: null, googleCalendarId: null } }),
  ])
  invalidateGoogleCache(workspaceId)
  return NextResponse.json(toCalendarState(null))
}

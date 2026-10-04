import { NextResponse } from 'next/server'
import { denyUnless } from '@/server/auth/guard'
import type { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import { badRequest, readJson, sessionWorkspaceId, unauthorized } from '@/server/messages/api'
import { invalidateGoogleCache } from '@/server/calendar/live'
import { readTokens, revokeToken } from '@/server/calendar/google'
import { apiError, getCalendarState, getConnection, isRealConnection, parseCalendarios } from '@/server/calendar/service'
import { LEMBRETES } from '@/server/calendar/types'

export const dynamic = 'force-dynamic'

/** GET /api/calendar -> CalendarStateDto (sem conexão: conectado=false e padrões da spec). */
export async function GET() {
  const deny = await denyUnless('agenda.use'); if (deny) return deny
  const workspaceId = await sessionWorkspaceId()
  if (!workspaceId) return unauthorized()
  return NextResponse.json(await getCalendarState(workspaceId))
}

const patchSchema = z
  .object({
    iaPodeAgendar: z.boolean().optional(),
    pedirConfirmacao: z.boolean().optional(),
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
  const deny = await denyUnless('calendar.manage'); if (deny) return deny
  const workspaceId = await sessionWorkspaceId()
  if (!workspaceId) return unauthorized()

  const json = await readJson(req)
  const parsed = patchSchema.safeParse(json)
  if (!parsed.success) return badRequest('Preferências inválidas')
  const b = parsed.data

  // "IA pode agendar" vale com ou sem Google: a fonte única é o agente (AiAgent.canSchedule); a coluna antiga acompanha.
  if (b.iaPodeAgendar !== undefined) {
    await db.aiAgent.upsert({ where: { workspaceId }, create: { workspaceId, canSchedule: b.iaPodeAgendar }, update: { canSchedule: b.iaPodeAgendar } })
    await db.calendarConnection.updateMany({ where: { workspaceId }, data: { iaPodeAgendar: b.iaPodeAgendar } })
  }

  const conn = await getConnection(workspaceId)
  if (!conn) {
    // Sem Google conectado só a opção da IA pode mudar; o resto grava na conexão.
    const soIa = Object.keys(b).every((k) => k === 'iaPodeAgendar')
    if (soIa) return NextResponse.json(await getCalendarState(workspaceId))
    return apiError('NAO_CONECTADO', 'Google Agenda não conectado.', 404)
  }

  const data: Prisma.CalendarConnectionUpdateInput = {}
  if (b.pedirConfirmacao !== undefined) data.pedirConfirmacao = b.pedirConfirmacao
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

  if (Object.keys(data).length > 0) await db.calendarConnection.update({ where: { workspaceId }, data })
  if (b.calendarios !== undefined || b.destinoId !== undefined) invalidateGoogleCache(workspaceId)
  return NextResponse.json(await getCalendarState(workspaceId))
}

/**
 * DELETE /api/calendar -> desconecta: revoga o token no Google (best-effort), apaga a conexão
 * (e os tokens). Eventos locais permanecem; o vínculo com o Google (googleEventId) é zerado.
 * 200 CalendarStateDto (já desconectado) | 401. Idempotente.
 */
export async function DELETE() {
  const deny = await denyUnless('calendar.manage'); if (deny) return deny
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
  return NextResponse.json(await getCalendarState(workspaceId))
}

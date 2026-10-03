import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { badRequest, sessionWorkspaceId, unauthorized } from '@/server/messages/api'
import { freeBusy } from '@/server/calendar/google'
import {
  MAX_DURACAO_MIN,
  MAX_EVENT_MS,
  getConnection,
  isRealConnection,
  logGoogleFailure,
  selectedIds,
} from '@/server/calendar/service'
import {
  DAY_END_HOUR,
  DAY_START_HOUR,
  SLOT_STEP_MIN,
  addMin,
  isValidDateStr,
  overlaps,
  spToDate,
  toSpHM,
} from '@/server/calendar/time'
import type { FreeSlotsResponse } from '@/server/calendar/types'

export const dynamic = 'force-dynamic'

const querySchema = z.object({
  date: z.string().refine((s) => isValidDateStr(s) && s >= '2000-01-01' && s <= '2100-12-31'),
  duracaoMin: z.coerce.number().int().min(5).max(MAX_DURACAO_MIN).optional(),
  serviceTypeId: z.string().min(1).optional(),
  ignoreEventId: z.string().min(1).optional(),
})

/**
 * GET /api/events/free?date=YYYY-MM-DD&duracaoMin=
 * Inícios livres (08:00 até 18:00 - duração, passo de 30 min, horário de São Paulo).
 * duracaoMin omitido -> duração padrão da conexão (ou 60). Resposta: FreeSlotsResponse.
 */
export async function GET(req: NextRequest) {
  const workspaceId = await sessionWorkspaceId()
  if (!workspaceId) return unauthorized()

  const sp = req.nextUrl.searchParams
  const parsed = querySchema.safeParse({
    date: sp.get('date') ?? '',
    duracaoMin: sp.get('duracaoMin') ?? undefined,
    serviceTypeId: sp.get('serviceTypeId') ?? undefined,
    ignoreEventId: sp.get('ignoreEventId') ?? undefined,
  })
  if (!parsed.success) return badRequest('Parâmetros inválidos: date (YYYY-MM-DD) e duracaoMin')
  const { date } = parsed.data

  const conn = await getConnection(workspaceId)
  let duracaoMin = parsed.data.duracaoMin
  if (duracaoMin === undefined && parsed.data.serviceTypeId) {
    const st = await db.serviceType.findFirst({
      where: { id: parsed.data.serviceTypeId, workspaceId },
      select: { duracaoMin: true },
    })
    duracaoMin = st?.duracaoMin
  }
  duracaoMin = duracaoMin ?? conn?.duracaoPadraoMin ?? 60
  const ignoreId = parsed.data.ignoreEventId
  const ignored = ignoreId
    ? await db.event.findFirst({ where: { id: ignoreId, workspaceId }, select: { googleEventId: true, inicio: true, duracaoMin: true } })
    : null

  const dayStart = spToDate(date, '00:00')
  const dayEnd = addMin(dayStart, 24 * 60)

  const local = await db.event.findMany({
    where: {
      workspaceId,
      inicio: { gte: new Date(dayStart.getTime() - MAX_EVENT_MS), lt: dayEnd },
      ...(ignoreId ? { id: { not: ignoreId } } : {}),
    },
    select: { inicio: true, duracaoMin: true },
  })
  const busy: { start: Date; end: Date }[] = local.map((e) => ({
    start: e.inicio,
    end: addMin(e.inicio, e.duracaoMin),
  }))

  let googleConsultado = false
  if (conn && isRealConnection(conn)) {
    try {
      const gb = await freeBusy(workspaceId, selectedIds(conn), dayStart, dayEnd)
      // O evento editado também aparece no free/busy do Google: tira só o seu intervalo antigo.
      const oIni = ignored?.googleEventId ? ignored.inicio.getTime() : null
      const oFim = ignored ? addMin(ignored.inicio, ignored.duracaoMin).getTime() : null
      busy.push(...gb.filter((b) => !(oIni !== null && b.start.getTime() === oIni && b.end.getTime() === oFim)))
      googleConsultado = true
    } catch (err) {
      logGoogleFailure('freeBusy', err)
    }
  }

  const horarios: string[] = []
  const lastStart = DAY_END_HOUR * 60 - duracaoMin
  for (let m = DAY_START_HOUR * 60; m <= lastStart; m += SLOT_STEP_MIN) {
    const ini = spToDate(date, `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`)
    const fim = addMin(ini, duracaoMin)
    // Horário que já começou não é oferecido (agendar no passado é recusado em POST/PATCH /api/events).
    if (ini.getTime() > Date.now() && !busy.some((b) => overlaps(ini, fim, b.start, b.end))) horarios.push(toSpHM(ini))
  }

  return NextResponse.json({ date, duracaoMin, horarios, googleConsultado } satisfies FreeSlotsResponse)
}

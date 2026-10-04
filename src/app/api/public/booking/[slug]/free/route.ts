import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { slotsForOneDay, slotsForWindow } from '@/server/booking/availability'
import { json, linkIndisponivel, throttled, tooMany } from '@/server/booking/http'
import { getPublicWorkspace } from '@/server/booking/public'
import { isValidDateStr } from '@/server/calendar/time'

export const dynamic = 'force-dynamic'

const querySchema = z.object({
  serviceTypeId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  date: z.string().refine(isValidDateStr).optional(),
})

/**
 * GET /api/public/booking/[slug]/free?serviceTypeId=&date=YYYY-MM-DD  (sem sessão)
 *  - com date: { date, horarios: ["09:00", ...] } (só horários livres)
 *  - sem date: { dias: [{ date, livres }] } para a janela inteira (livres = quantidade de horários; 0 = dia cheio)
 * Nunca devolve título, nome ou horário de outros compromissos.
 */
export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  if (throttled(req, 'pub-free', 240, 10 * 60_000)) return tooMany()
  const ws = await getPublicWorkspace(params.slug)
  if (!ws) return linkIndisponivel()

  const sp = req.nextUrl.searchParams
  const parsed = querySchema.safeParse({ serviceTypeId: sp.get('serviceTypeId') ?? '', date: sp.get('date') ?? undefined })
  if (!parsed.success) return json({ error: 'INVALIDO', message: 'Parâmetros inválidos.' }, 400)

  const st = await db.serviceType.findFirst({
    where: { id: parsed.data.serviceTypeId, workspaceId: ws.id, ativo: true },
    select: { duracaoMin: true },
  })
  if (!st) return json({ error: 'INVALIDO', message: 'Serviço indisponível.' }, 404)

  const cfg = { antecedenciaMin: ws.antecedenciaMin, diasAFrente: ws.diasAFrente }
  if (parsed.data.date) {
    const horarios = await slotsForOneDay(ws.id, parsed.data.date, st.duracaoMin, cfg)
    return json({ date: parsed.data.date, horarios })
  }
  const map = await slotsForWindow(ws.id, st.duracaoMin, cfg)
  return json({ dias: Array.from(map, ([date, h]) => ({ date, livres: h.length })) })
}

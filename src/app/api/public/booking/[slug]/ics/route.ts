import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { buildIcs } from '@/server/booking/ics'
import { json, throttled, tooMany } from '@/server/booking/http'
import { verifyEventToken } from '@/server/booking/security'

export const dynamic = 'force-dynamic'

/** GET /api/public/booking/[slug]/ics?t=<token do agendamento>  -> arquivo .ics só do agendamento do portador do token. */
export async function GET(req: NextRequest) {
  if (throttled(req, 'pub-ics', 60, 10 * 60_000)) return tooMany()
  const id = verifyEventToken(req.nextUrl.searchParams.get('t') ?? '')
  const ev = id
    ? await db.event.findFirst({
        where: { id, canal: 'link' },
        select: { id: true, inicio: true, duracaoMin: true, tipo: true, workspace: { select: { nome: true } } },
      })
    : null
  if (!ev) return json({ error: 'NAO_ENCONTRADO', message: 'Agendamento não encontrado.' }, 404)
  const body = buildIcs({ id: ev.id, inicio: ev.inicio, duracaoMin: ev.duracaoMin, servico: ev.tipo, negocio: ev.workspace.nome })
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="agendamento.ics"',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}

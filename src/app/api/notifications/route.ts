import type { NextRequest } from 'next/server'
import { badRequest, contextoDaSessao, json, limitar, listQuery, tooMany, unauthorized } from '@/server/notifications/http'
import { clearNotifications, listNotifications, parseCursor } from '@/server/notifications/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/notifications?antes=<cursor>&limite=<n> -> histórico (7 dias) da pessoa NESTE espaço, mais novo primeiro. */
export async function GET(req: NextRequest) {
  const ctx = await contextoDaSessao()
  if (!ctx) return unauthorized()
  const retry = limitar(ctx.userId, 'geral')
  if (retry) return tooMany(retry)
  const sp = req.nextUrl.searchParams
  const q = listQuery.safeParse({ antes: sp.get('antes') ?? undefined, limite: sp.get('limite') ?? undefined })
  if (!q.success) return badRequest()
  if (q.data.antes && !parseCursor(q.data.antes)) return badRequest('Cursor inválido')
  return json(await listNotifications(ctx, { antes: q.data.antes, limite: q.data.limite }))
}

/** DELETE /api/notifications -> limpa o histórico da pessoa neste espaço. O que foi apagado não reaparece. */
export async function DELETE() {
  const ctx = await contextoDaSessao()
  if (!ctx) return unauthorized()
  const retry = limitar(ctx.userId, 'geral')
  if (retry) return tooMany(retry)
  return json({ apagadas: await clearNotifications(ctx) })
}

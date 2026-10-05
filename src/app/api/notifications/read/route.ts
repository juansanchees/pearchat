import { badRequest, contextoDaSessao, json, lerCorpo, limitar, notFound, readBody, tooMany, unauthorized } from '@/server/notifications/http'
import { markRead } from '@/server/notifications/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST /api/notifications/read { ids? } -> marca como lidas as ids (todas precisam ser suas, senão 404) ou todas. */
export async function POST(req: Request) {
  const ctx = await contextoDaSessao()
  if (!ctx) return unauthorized()
  const retry = limitar(ctx.userId, 'geral')
  if (retry) return tooMany(retry)
  const body = await lerCorpo(req, true)
  if (!body.ok) return body.res
  const parsed = readBody.safeParse(body.valor)
  if (!parsed.success) return badRequest()
  const r = await markRead(ctx, parsed.data.ids)
  return r.ok ? json({ alteradas: r.alterados }) : notFound()
}

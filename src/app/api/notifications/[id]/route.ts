import { contextoDaSessao, ID_RE, json, limitar, notFound, tooMany, unauthorized } from '@/server/notifications/http'
import { deleteNotification } from '@/server/notifications/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** DELETE /api/notifications/<id> -> apaga uma notificação. Id de outra pessoa ou de outro espaço = 404. */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await contextoDaSessao()
  if (!ctx) return unauthorized()
  const retry = limitar(ctx.userId, 'geral')
  if (retry) return tooMany(retry)
  if (!ID_RE.test(params.id)) return notFound()
  const r = await deleteNotification(ctx, params.id)
  return r.ok ? json({ ok: true }) : notFound()
}

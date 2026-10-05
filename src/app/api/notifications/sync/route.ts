import { badRequest, contextoDaSessao, json, lerCorpo, limitar, syncBody, tooMany, unauthorized } from '@/server/notifications/http'
import { syncNotifications } from '@/server/notifications/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/notifications/sync { visivel, tela? } -> calcula o que aconteceu desde a última vez (lendo o que já está gravado),
 * guarda como histórico e devolve { naoLidas, itens, ausenteDesde, resumoAusente }. Idempotente; seguro com duas abas.
 * Usuário e espaço vêm SÓ da sessão.
 */
export async function POST(req: Request) {
  const ctx = await contextoDaSessao()
  if (!ctx) return unauthorized()
  const retry = limitar(ctx.userId, 'sync')
  if (retry) return tooMany(retry)
  const body = await lerCorpo(req)
  if (!body.ok) return body.res
  const parsed = syncBody.safeParse(body.valor)
  if (!parsed.success) return badRequest()
  return json(await syncNotifications(ctx, { visivel: parsed.data.visivel, tela: parsed.data.tela }))
}

import { contextoDaSessao, json, limitar, tooMany, unauthorized } from '@/server/notifications/http'
import { heartbeat } from '@/server/notifications/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST /api/notifications/heartbeat -> batimento leve (aba visível e em foco): só atualiza a presença da pessoa neste espaço. */
export async function POST() {
  const ctx = await contextoDaSessao()
  if (!ctx) return unauthorized()
  const retry = limitar(ctx.userId, 'heartbeat')
  if (retry) return tooMany(retry)
  await heartbeat(ctx)
  return json({ ok: true })
}

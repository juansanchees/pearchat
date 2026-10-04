import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { denyUnless } from '@/server/auth/guard'
import { JANELA_PADRAO, requestPendingBatch } from '@/server/engine/pending'
import { pendingFail } from '@/server/engine/pending-http'
import { badRequest, readJson, sessionWorkspaceId, unauthorized } from '@/server/messages/api'

export const dynamic = 'force-dynamic'

const schema = z.object({ janela: z.enum(['24h', '3d', '7d']).default(JANELA_PADRAO) }).strict()

// Enfileira as respostas da IA para as conversas paradas da janela. Só dono/administrador. O servidor impõe tudo:
// janela máxima de 7 dias, no máximo 50 conversas por execução (as mais recentes), respostas espaçadas e nada duplicado.
// O cliente HTTP só escolhe a janela: nunca texto, destinatário nem quantidade.
export async function POST(req: NextRequest) {
  const deny = await denyUnless('agent.manage')
  if (deny) return deny
  const workspaceId = await sessionWorkspaceId()
  if (!workspaceId) return unauthorized()

  const raw = await readJson(req)
  const parsed = schema.safeParse(raw ?? {})
  if (!parsed.success) return badRequest("Janela inválida (use '24h', '3d' ou '7d')")

  const r = await requestPendingBatch(workspaceId, parsed.data.janela)
  if (!r.ok) return pendingFail(r.code, r.faltam !== undefined ? { faltam: r.faltam } : {})
  return NextResponse.json(r, { status: 202 })
}

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { badRequest, isValidId, notFound, readJson, sessionIds, unauthorized } from '@/server/messages/api'
import { loadConversationItem } from '@/server/messages/dto'
import { emitToWorkspace } from '@/server/realtime/emit'
import { DEVOLVER_JANELA_MS, requestAiReply } from '@/server/engine/pending'
import { logError } from '@/server/engine/util'

export const dynamic = 'force-dynamic'

const schema = z.object({ mode: z.enum(['humano', 'ia']) })

// "Assumir conversa" (humano) / "Devolver para IA/automação" (ia, com o agente ou o follow-up ligado).
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ids = await sessionIds()
  if (!ids) return unauthorized()
  const { workspaceId, userId } = ids
  if (!isValidId(params.id)) return notFound()

  const parsed = schema.safeParse(await readJson(req))
  if (!parsed.success) return badRequest("Modo inválido (use 'humano' ou 'ia')")

  const conv = await db.conversation.findFirst({ where: { id: params.id, workspaceId }, select: { id: true } })
  if (!conv) return notFound()

  if (parsed.data.mode === 'ia') {
    const [agent, rule] = await Promise.all([
      db.aiAgent.findUnique({ where: { workspaceId }, select: { enabled: true } }),
      db.followUpRule.findUnique({ where: { workspaceId }, select: { enabled: true } }),
    ])
    if (!agent?.enabled && !rule?.enabled) {
      return NextResponse.json({ error: 'O agente de IA e o follow-up estão desligados', code: 'IA_DESLIGADA' }, { status: 409 })
    }
  }

  await db.conversation.update({
    where: { id: conv.id },
    // Equipe: devolver para a IA/automação tira o responsável (se a IA passar de novo, ela volta "sem responsável").
    data: { mode: parsed.data.mode === 'ia' ? 'IA' : 'HUMANO', ...(parsed.data.mode === 'ia' ? { assigneeId: null, assignedAt: null } : {}) },
  })
  // Equipe: "Assumir conversa" sem responsável atribui a quem assumiu.
  if (parsed.data.mode === 'humano') {
    await db.conversation.updateMany({ where: { id: conv.id, assigneeId: null }, data: { assigneeId: userId, assignedAt: new Date() } })
  }
  // "Devolver para a IA": se o cliente ficou sem resposta há menos de 24 h, a IA responde em seguida (mesmo caminho do
  // "Responder com a IA"; mais antiga que isso, só devolve). Falha aqui nunca desfaz a devolução.
  if (parsed.data.mode === 'ia') {
    await requestAiReply(workspaceId, conv.id, { maxAgeMs: DEVOLVER_JANELA_MS }).catch((e) => logError('mode', 'resposta ao devolver para a IA', e))
  }
  const item = await loadConversationItem(workspaceId, conv.id)
  if (item) emitToWorkspace(workspaceId, 'conversation.updated', { workspaceId, conversation: item })
  return NextResponse.json(item)
}

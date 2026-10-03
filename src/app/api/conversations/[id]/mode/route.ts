import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { badRequest, notFound, sessionWorkspaceId, unauthorized } from '@/server/messages/api'
import { loadConversationItem } from '@/server/messages/dto'
import { emitToWorkspace } from '@/server/realtime/emit'

export const dynamic = 'force-dynamic'

const schema = z.object({ mode: z.enum(['humano', 'ia']) })

// "Assumir conversa" (humano) / "Devolver para IA" (ia, só com o agente ligado).
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const workspaceId = await sessionWorkspaceId()
  if (!workspaceId) return unauthorized()

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return badRequest("Modo inválido (use 'humano' ou 'ia')")

  const conv = await db.conversation.findFirst({ where: { id: params.id, workspaceId }, select: { id: true } })
  if (!conv) return notFound()

  if (parsed.data.mode === 'ia') {
    const agent = await db.aiAgent.findUnique({ where: { workspaceId }, select: { enabled: true } })
    if (!agent?.enabled) {
      return NextResponse.json({ error: 'O agente de IA está desligado', code: 'IA_DESLIGADA' }, { status: 409 })
    }
  }

  await db.conversation.update({
    where: { id: conv.id },
    data: { mode: parsed.data.mode === 'ia' ? 'IA' : 'HUMANO' },
  })
  const item = await loadConversationItem(workspaceId, conv.id)
  if (item) emitToWorkspace(workspaceId, 'conversation.updated', { workspaceId, conversation: item })
  return NextResponse.json(item)
}

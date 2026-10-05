import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { denyUnless } from '@/server/auth/guard'
import { badRequest, isValidId, notFound, sessionIds, unauthorized } from '@/server/messages/api'
import { readJson } from '@/server/http/body'
import { loadConversationItem } from '@/server/messages/dto'
import { emitToWorkspace } from '@/server/realtime/emit'
import { peopleWithAccess } from '@/server/team/access'

export const dynamic = 'force-dynamic'

const schema = z.object({ userId: z.string().max(64).nullable() })

// Define (ou limpa, com userId: null) o responsável da conversa. O responsável precisa ser uma pessoa ATIVA com acesso
// a este espaço (dono/admin, ou atendente membro dele); qualquer outro id vindo do cliente é recusado.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const deny = await denyUnless('conversations.use')
  if (deny) return deny
  const ids = await sessionIds()
  if (!ids) return unauthorized()
  const { workspaceId } = ids
  if (!isValidId(params.id)) return notFound()

  const parsed = schema.safeParse(await readJson(req))
  if (!parsed.success) return badRequest('Responsável inválido')
  const target = parsed.data.userId

  const conv = await db.conversation.findFirst({ where: { id: params.id, workspaceId }, select: { id: true, workspace: { select: { organizationId: true } } } })
  if (!conv) return notFound()

  if (target !== null) {
    const orgId = conv.workspace.organizationId ?? ids.organizationId
    const people = orgId ? await peopleWithAccess(workspaceId, orgId) : []
    if (!isValidId(target) || !people.some((p) => p.id === target)) {
      return NextResponse.json({ error: 'Essa pessoa não tem acesso a este WhatsApp', code: 'SEM_ACESSO' }, { status: 400 })
    }
  }

  await db.conversation.update({ where: { id: conv.id }, data: { assigneeId: target, assignedAt: target ? new Date() : null } })
  const item = await loadConversationItem(workspaceId, conv.id)
  if (item) emitToWorkspace(workspaceId, 'conversation.updated', { workspaceId, conversation: item })
  return NextResponse.json(item)
}

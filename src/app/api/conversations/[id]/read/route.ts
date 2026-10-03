import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isValidId, notFound, sessionWorkspaceId, unauthorized } from '@/server/messages/api'
import { loadConversationItem } from '@/server/messages/dto'
import { emitToWorkspace } from '@/server/realtime/emit'

export const dynamic = 'force-dynamic'

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const workspaceId = await sessionWorkspaceId()
  if (!workspaceId) return unauthorized()
  if (!isValidId(params.id)) return notFound()

  const { count } = await db.conversation.updateMany({
    where: { id: params.id, workspaceId },
    data: { unread: 0 },
  })
  if (count === 0) return notFound()

  const item = await loadConversationItem(workspaceId, params.id)
  if (item) emitToWorkspace(workspaceId, 'conversation.updated', { workspaceId, conversation: item })
  return NextResponse.json(item)
}

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { contactNotFound, isUniqueViolation, sessionWorkspaceId, unauthorized } from '@/server/contacts/api'
import { loadConversationItem } from '@/server/messages/dto'
import { emitToWorkspace } from '@/server/realtime/emit'

export const dynamic = 'force-dynamic'

// Devolve a conversa do contato, criando uma vazia se ainda não existir.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const workspaceId = await sessionWorkspaceId()
  if (!workspaceId) return unauthorized()

  const contact = await db.contact.findFirst({
    where: { id: params.id, workspaceId },
    select: { id: true, conversation: { select: { id: true } } },
  })
  if (!contact) return contactNotFound()
  if (contact.conversation) return NextResponse.json({ conversationId: contact.conversation.id })

  try {
    const created = await db.conversation.create({
      data: { workspaceId, contactId: contact.id },
      select: { id: true },
    })
    const item = await loadConversationItem(workspaceId, created.id)
    if (item) emitToWorkspace(workspaceId, 'conversation.updated', { workspaceId, conversation: item })
    return NextResponse.json({ conversationId: created.id }, { status: 201 })
  } catch (e) {
    if (!isUniqueViolation(e)) throw e
    // outra requisição criou primeiro
    const existing = await db.conversation.findUnique({ where: { contactId: contact.id }, select: { id: true } })
    if (!existing) throw e
    return NextResponse.json({ conversationId: existing.id })
  }
}

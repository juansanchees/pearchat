import { db } from '@/lib/db'
import { loadConversationItem, toMessageDTO } from '@/server/messages/dto'
import { emitToWorkspace } from '@/server/realtime/emit'

/** Avisa as telas abertas que a mensagem mudou (mídia baixada, transcrição pronta, erro...). Nunca lança. */
export async function emitMessageUpdated(messageId: string): Promise<void> {
  try {
    const m = await db.message.findUnique({ where: { id: messageId }, include: { conversation: { select: { workspaceId: true } } } })
    if (!m) return
    const workspaceId = m.conversation.workspaceId
    emitToWorkspace(workspaceId, 'message.updated', { workspaceId, conversationId: m.conversationId, message: toMessageDTO(m) })
    const item = await loadConversationItem(workspaceId, m.conversationId)
    if (item) emitToWorkspace(workspaceId, 'conversation.updated', { workspaceId, conversation: item })
  } catch (e) {
    console.error('[media] falha ao emitir atualização:', e instanceof Error ? e.message : 'erro')
  }
}

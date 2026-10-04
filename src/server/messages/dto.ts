import type { Contact, Conversation, Message } from '@prisma/client'
import { db } from '@/lib/db'
import type { ConversationItem } from '@/components/conversas/types'
import type { MediaStatusKind, MediaTypeKind, MessageAuthorKind, MessageDTO, TranscriptStatusKind } from '@/lib/types'
import { isMediaKind, isMediaLabel } from '@/server/media/mime'

export function toMessageDTO(m: Message): MessageDTO {
  return {
    id: m.id,
    conversationId: m.conversationId,
    direction: m.direction === 'IN' ? 'in' : 'out',
    author: m.author.toLowerCase() as MessageAuthorKind,
    body: m.body,
    mediaUrl: m.mediaKey && m.mediaStatus === 'ok' ? `/api/media/${m.id}` : m.mediaUrl,
    status: m.status.toLowerCase() as MessageDTO['status'],
    createdAt: m.createdAt.toISOString(),
    ...(m.mediaType && isMediaKind(m.mediaType)
      ? {
          mediaType: m.mediaType as MediaTypeKind,
          mediaMime: m.mediaMime,
          mediaSize: m.mediaSize,
          mediaName: m.mediaName,
          mediaDurationSec: m.mediaDurationSec,
          mediaStatus: (m.mediaStatus ?? 'pendente') as MediaStatusKind,
          transcript: m.transcript,
          transcriptStatus: m.transcriptStatus as TranscriptStatusKind | null,
        }
      : {}),
  }
}

export type ConversationWithRefs = Conversation & { contact: Contact; messages: Message[] }

export function toConversationItem(c: ConversationWithRefs): ConversationItem {
  const last = c.messages[0]
  return {
    id: c.id,
    contactId: c.contactId,
    nome: c.contact.nome,
    telefone: c.contact.telefone,
    mode: c.mode ? (c.mode.toLowerCase() as 'ia' | 'humano') : null,
    unread: c.unread,
    typing: c.typing,
    // Mídia: o rótulo "[Imagem]" não vira texto (a lista mostra ícone + "Foto"); só a legenda, se houver.
    lastMessagePreview: last ? (last.mediaType && isMediaLabel(last.body) ? '' : last.body) : null,
    lastMessageMedia:
      last?.mediaType && isMediaKind(last.mediaType) ? { type: last.mediaType as MediaTypeKind, durationSec: last.mediaDurationSec } : null,
    lastMessageAt: c.lastMessageAt ? c.lastMessageAt.toISOString() : null,
    lastMessageAuthor: last ? (last.author.toLowerCase() as MessageAuthorKind) : null,
  }
}

export const conversationInclude = {
  contact: true,
  messages: { orderBy: { createdAt: 'desc' as const }, take: 1 },
}

export async function loadConversationItem(
  workspaceId: string,
  conversationId: string,
): Promise<ConversationItem | null> {
  const c = await db.conversation.findFirst({
    where: { id: conversationId, workspaceId },
    include: conversationInclude,
  })
  return c ? toConversationItem(c) : null
}

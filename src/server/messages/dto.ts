import type { Contact, Conversation, Message } from '@prisma/client'
import { db } from '@/lib/db'
import type { ConversationItem } from '@/components/conversas/types'
import type { MediaStatusKind, MediaTypeKind, MessageAuthorKind, MessageDTO, TranscriptStatusKind } from '@/lib/types'
import { isMediaKind, isMediaLabel } from '@/server/media/mime'

/** `senderNome` (Equipe): primeiro nome de quem enviou pelo app; opcional para não mudar quem já chama com 1 argumento. */
export function toMessageDTO(m: Message, senderNome?: string | null): MessageDTO {
  return {
    ...(m.senderUserId ? { senderUserId: m.senderUserId, ...(senderNome ? { senderNome } : {}) } : {}),
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

export type ConversationWithRefs = Conversation & {
  contact: Contact
  messages: Message[]
  assignee?: { id: string; nome: string; fotoUrl: string | null; image: string | null } | null
}

/** Primeiro nome de quem enviou cada mensagem (uma consulta por lote). Mensagens sem remetente do app ficam de fora. */
export async function senderFirstNames(messages: Pick<Message, 'senderUserId'>[]): Promise<Map<string, string>> {
  const ids = Array.from(new Set(messages.map((m) => m.senderUserId).filter((v): v is string => !!v)))
  if (ids.length === 0) return new Map()
  const rows = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, nome: true } })
  return new Map(rows.map((u) => [u.id, u.nome.trim().split(/\s+/)[0]]))
}

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
    // Equipe: responsável pela conversa (null = sem responsável).
    assignee: c.assignee ? { id: c.assignee.id, nome: c.assignee.nome, fotoUrl: c.assignee.fotoUrl ?? c.assignee.image } : null,
  }
}

export const conversationInclude = {
  contact: true,
  assignee: { select: { id: true, nome: true, fotoUrl: true, image: true } },
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

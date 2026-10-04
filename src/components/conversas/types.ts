import type { ConversationListItem, MediaTypeKind, MessageAuthorKind } from '@/lib/types'

// ConversationListItem + autor da última mensagem (para o prefixo "Você:" / "{agente}:").
export type ConversationItem = ConversationListItem & {
  lastMessageAuthor?: MessageAuthorKind | null
  /** Última mensagem é uma mídia: a lista mostra ícone + rótulo (Foto, Áudio 0:12...). */
  lastMessageMedia?: { type: MediaTypeKind; durationSec: number | null } | null
}

export type ConversationFilter = 'todas' | 'nao_lidas' | 'com_ia'

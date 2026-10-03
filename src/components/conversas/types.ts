import type { ConversationListItem, MessageAuthorKind } from '@/lib/types'

// ConversationListItem + autor da última mensagem (para o prefixo "Você:" / "{agente}:").
export type ConversationItem = ConversationListItem & {
  lastMessageAuthor?: MessageAuthorKind | null
}

export type ConversationFilter = 'todas' | 'nao_lidas' | 'com_ia'

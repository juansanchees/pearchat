import type {
  ConnectionStatusKind,
  ConversationListItem,
  MessageDTO,
  MessageStatusKind,
} from '@/lib/types'

// Eventos Socket.io (somente tipos; o servidor socket vem depois).
// Cada cliente entra na sala `workspace:<workspaceId>` (veja workspaceRoom).

export interface MessageReceivedPayload {
  workspaceId: string
  conversationId: string
  message: MessageDTO
}

export interface MessageStatusPayload {
  workspaceId: string
  conversationId: string
  messageId: string
  status: MessageStatusKind
}

export interface ConnectionUpdatePayload {
  workspaceId: string
  status: ConnectionStatusKind
  numero: string | null
  qr?: string
}

export interface ConversationUpdatedPayload {
  workspaceId: string
  conversation: ConversationListItem
}

/** A IA passou a conversa para uma pessoa (regra de passagem ou limite do plano). */
export interface HandoffRequestedPayload {
  workspaceId: string
  conversationId: string
  contactName: string
  motivo: string
}

export interface ServerToClientEvents {
  'message.received': (payload: MessageReceivedPayload) => void
  'message.status': (payload: MessageStatusPayload) => void
  'connection.update': (payload: ConnectionUpdatePayload) => void
  'conversation.updated': (payload: ConversationUpdatedPayload) => void
  'handoff.requested': (payload: HandoffRequestedPayload) => void
}

export interface ClientToServerEvents {
  'workspace.join': (workspaceId: string) => void
}

export const workspaceRoom = (workspaceId: string) => `workspace:${workspaceId}`

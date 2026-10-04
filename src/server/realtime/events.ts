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

/**
 * Aviso LEVE entre espaços da mesma organização (sala `org:<id>`): contadores do espaço e, quando for uma passagem
 * da IA, quem passou o quê. Nunca leva conteúdo de mensagens; eventos completos só vão para a sala do espaço ativo.
 */
export interface SpaceAttentionPayload {
  workspaceId: string
  nome: string
  unread: number
  handoffs: number
  handoff?: { agente: string; contato: string; motivo: string }
}

/** A agenda do espaço mudou fora da tela do dono (ex.: cliente agendou pelo link público). */
export interface AgendaUpdatedPayload {
  workspaceId: string
  /** Presente quando o agendamento veio do link público: o painel mostra um aviso. */
  link?: { cliente: string; inicio: string }
}

export interface ServerToClientEvents {
  'space.attention': (payload: SpaceAttentionPayload) => void
  'message.received': (payload: MessageReceivedPayload) => void
  'message.status': (payload: MessageStatusPayload) => void
  'connection.update': (payload: ConnectionUpdatePayload) => void
  'conversation.updated': (payload: ConversationUpdatedPayload) => void
  'handoff.requested': (payload: HandoffRequestedPayload) => void
  'agenda.updated': (payload: AgendaUpdatedPayload) => void
}

export interface ClientToServerEvents {
  'workspace.join': (workspaceId: string) => void
}

export const workspaceRoom = (workspaceId: string) => `workspace:${workspaceId}`
export const orgRoom = (organizationId: string) => `org:${organizationId}`

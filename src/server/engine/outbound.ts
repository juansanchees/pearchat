import type { Message, MessageAuthor } from '@prisma/client'
import { db } from '@/lib/db'
import { loadConversationItem, senderFirstNames, toMessageDTO } from '@/server/messages/dto'
import { emitToWorkspace } from '@/server/realtime/emit'
import { getProvider } from '@/server/whatsapp'
import type { ContactRef } from '@/server/whatsapp'
import type { ConnectedSession } from './util'
import { bumpUsage, shortError } from './util'

export type OutboundContent = { kind: 'text'; text: string } | { kind: 'template'; name: string; vars: string[]; body: string }

export class OutboundError extends Error {}

/**
 * Envia uma mensagem do motor (IA, disparo, follow-up, lembrete) e registra a Message OUT na conversa.
 * Não altera modo, typing nem unread: quem chama decide. Lança OutboundError se o provedor falhar
 * (a mensagem fica gravada com status FALHOU).
 */
export async function sendAndRecord(input: {
  session: ConnectedSession
  conversationId: string
  to: ContactRef
  author: MessageAuthor
  content: OutboundContent
  /** Conta em mensagensAtendimento no provedor oficial (não conta disparos por modelo de marketing). */
  countAtendimento?: boolean
  /** Emite 'message.received' + 'conversation.updated' (padrão: true). */
  emit?: boolean
  /** Pessoa da equipe que enviou (Equipe: autoria da mensagem). Vazio nos envios automáticos. */
  senderUserId?: string
}): Promise<Message> {
  const { session, conversationId, to, author, content } = input
  const { workspaceId } = session
  const now = new Date()
  const body = content.kind === 'text' ? content.text : content.body
  const pending = await db.message.create({
    data: { conversationId, direction: 'OUT', author, body, status: 'PENDENTE', createdAt: now, senderUserId: input.senderUserId ?? null },
  })

  const provider = getProvider(session.kind)
  let sent: Message
  try {
    let providerMessageId: string
    if (content.kind === 'text') {
      providerMessageId = (await provider.sendText(workspaceId, to, content.text)).providerMessageId
    } else {
      if (!provider.sendTemplate) throw new OutboundError('Provedor sem suporte a modelos')
      providerMessageId = (await provider.sendTemplate(workspaceId, to, content.name, content.vars)).providerMessageId
    }
    sent = await db.message.update({ where: { id: pending.id }, data: { providerMessageId, status: 'ENVIADA' } })
  } catch (e) {
    await db.message.update({ where: { id: pending.id }, data: { status: 'FALHOU' } })
    if (input.emit !== false) {
      const item = await loadConversationItem(workspaceId, conversationId)
      if (item) emitToWorkspace(workspaceId, 'conversation.updated', { workspaceId, conversation: item })
    }
    throw new OutboundError(shortError(e))
  }

  await db.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: now } })
  if (session.official && input.countAtendimento) await bumpUsage(workspaceId, { mensagensAtendimento: 1 })

  if (input.emit !== false) {
    emitToWorkspace(workspaceId, 'message.received', { workspaceId, conversationId, message: toMessageDTO(sent, (await senderFirstNames([sent])).get(input.senderUserId ?? '')) })
    const item = await loadConversationItem(workspaceId, conversationId)
    if (item) emitToWorkspace(workspaceId, 'conversation.updated', { workspaceId, conversation: item })
  }
  return sent
}

/** Garante a conversa do contato (cria se não existir). */
export async function ensureConversation(workspaceId: string, contactId: string): Promise<{ id: string }> {
  return db.conversation.upsert({
    where: { contactId },
    create: { workspaceId, contactId },
    update: {},
    select: { id: true },
  })
}

export const contactRef = (c: { waUserId: string | null; telefone: string | null }): ContactRef => ({
  waUserId: c.waUserId ?? undefined,
  telefone: c.telefone ?? undefined,
})

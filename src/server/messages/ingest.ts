import { Prisma } from '@prisma/client'
import type { Contact } from '@prisma/client'
import { db } from '@/lib/db'
import { emitToWorkspace } from '@/server/realtime/emit'
import type { ContactRef } from '@/server/whatsapp/provider'
import { scheduleAiReply } from '@/server/engine/ai-reply'
import { registerCampaignReplies } from '@/server/engine/campaigns'
import { cancelPendingFollowUps } from '@/server/engine/followup'
import { logError } from '@/server/engine/util'
import { loadConversationItem, toMessageDTO } from './dto'

const STATUS_RANK = { PENDENTE: 0, ENVIADA: 1, ENTREGUE: 2, LIDA: 3 } as const

async function findOrCreateContact(
  workspaceId: string,
  from: ContactRef,
  nome: string | undefined,
): Promise<Contact> {
  const { waUserId, telefone } = from
  let contact: Contact | null = null
  if (waUserId) contact = await db.contact.findUnique({ where: { workspaceId_waUserId: { workspaceId, waUserId } } })
  if (!contact && telefone) contact = await db.contact.findUnique({ where: { workspaceId_telefone: { workspaceId, telefone } } })

  if (contact) {
    const patch: Prisma.ContactUpdateInput = {}
    if (waUserId && !contact.waUserId) patch.waUserId = waUserId
    if (telefone && !contact.telefone) patch.telefone = telefone
    if (nome && contact.nome === (contact.telefone ?? contact.waUserId)) patch.nome = nome
    return Object.keys(patch).length ? db.contact.update({ where: { id: contact.id }, data: patch }) : contact
  }

  try {
    return await db.contact.create({
      data: {
        workspaceId,
        waUserId: waUserId ?? null,
        telefone: telefone ?? null,
        nome: nome?.trim() || telefone || waUserId || 'Contato',
      },
    })
  } catch (e) {
    // Corrida: outra mensagem criou o mesmo contato entre a busca e a criação.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const again = waUserId
        ? await db.contact.findUnique({ where: { workspaceId_waUserId: { workspaceId, waUserId } } })
        : telefone
          ? await db.contact.findUnique({ where: { workspaceId_telefone: { workspaceId, telefone } } })
          : null
      if (again) return again
    }
    throw e
  }
}

export async function ingestInboundMessage(input: {
  workspaceId: string
  from: ContactRef
  nome?: string
  body: string
  mediaUrl?: string
  providerMessageId: string
  timestamp: Date
}): Promise<void> {
  const { workspaceId, from, nome, body, mediaUrl, providerMessageId, timestamp } = input
  if (!from.waUserId && !from.telefone) return

  const dup = await db.message.findFirst({
    where: { providerMessageId, conversation: { workspaceId } },
    select: { id: true },
  })
  if (dup) return

  const contact = await findOrCreateContact(workspaceId, from, nome)

  const normalized = body.trim().toLowerCase()
  let optOut = contact.optOut
  if ((normalized === 'parar' || normalized === 'sair') && !contact.optOut) {
    await db.contact.update({ where: { id: contact.id }, data: { optOut: true } })
    optOut = true
  }

  const conversation = await db.conversation.upsert({
    where: { contactId: contact.id },
    create: { workspaceId, contactId: contact.id },
    update: {},
  })

  const message = await db.message.create({
    data: {
      conversationId: conversation.id,
      direction: 'IN',
      author: 'CLIENTE',
      body,
      mediaUrl: mediaUrl ?? null,
      status: 'ENTREGUE',
      providerMessageId,
      createdAt: timestamp,
    },
  })

  await db.conversation.update({
    where: { id: conversation.id },
    data: { unread: { increment: 1 }, lastMessageAt: timestamp },
  })

  emitToWorkspace(workspaceId, 'message.received', {
    workspaceId,
    conversationId: conversation.id,
    message: toMessageDTO(message),
  })
  const item = await loadConversationItem(workspaceId, conversation.id)
  if (item) emitToWorkspace(workspaceId, 'conversation.updated', { workspaceId, conversation: item })

  // Motor de automações: nenhuma falha aqui pode quebrar o recebimento da mensagem.
  try {
    await cancelPendingFollowUps(conversation.id, optOut ? 'Cliente pediu para parar' : 'Cliente respondeu')
    await registerCampaignReplies(workspaceId, contact.id, timestamp)
  } catch (e) {
    logError('ingest', 'follow-up/campanha', e)
  }
  await scheduleAiReply({ workspaceId, conversationId: conversation.id, optOut })
}

export async function updateMessageStatus(input: {
  workspaceId: string
  providerMessageId: string
  status: 'enviada' | 'entregue' | 'lida' | 'falhou'
}): Promise<void> {
  const { workspaceId, providerMessageId, status } = input
  const msg = await db.message.findFirst({
    where: { providerMessageId, conversation: { workspaceId } },
  })
  if (!msg) return

  const next = status.toUpperCase() as 'ENVIADA' | 'ENTREGUE' | 'LIDA' | 'FALHOU'
  if (msg.status === next) return
  // Não regride (ex.: "entregue" atrasado depois de "lida"); "falhou" sempre vale.
  if (next !== 'FALHOU') {
    const cur = msg.status === 'FALHOU' ? -1 : STATUS_RANK[msg.status]
    if (STATUS_RANK[next] <= cur) return
  }

  await db.message.update({ where: { id: msg.id }, data: { status: next } })
  emitToWorkspace(workspaceId, 'message.status', {
    workspaceId,
    conversationId: msg.conversationId,
    messageId: msg.id,
    status,
  })
}

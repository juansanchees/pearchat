import { db } from '@/lib/db'
import { providerToKind } from '@/lib/mappers'
import type { MessageDTO } from '@/lib/types'
import { emitToWorkspace } from '@/server/realtime/emit'
import { getProvider } from '@/server/whatsapp'
import { loadConversationItem, toMessageDTO } from './dto'

export type SendErrorCode = 'NAO_ENCONTRADA' | 'NAO_CONECTADO' | 'FORA_DA_JANELA_24H' | 'ENVIO_FALHOU'

export class SendError extends Error {
  constructor(
    public readonly code: SendErrorCode,
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'SendError'
  }
}

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

export async function sendUserMessage(input: {
  workspaceId: string
  conversationId: string
  body: string
}): Promise<MessageDTO> {
  const { workspaceId, conversationId, body } = input

  const conversation = await db.conversation.findFirst({
    where: { id: conversationId, workspaceId },
    include: { contact: true },
  })
  if (!conversation) throw new SendError('NAO_ENCONTRADA', 404, 'Conversa não encontrada')

  const session = await db.whatsAppSession.findUnique({ where: { workspaceId } })
  if (!session || session.status !== 'CONECTADO' || !session.provider) {
    throw new SendError('NAO_CONECTADO', 409, 'WhatsApp não está conectado')
  }
  const provider = getProvider(providerToKind(session.provider))
  const to = {
    waUserId: conversation.contact.waUserId ?? undefined,
    telefone: conversation.contact.telefone ?? undefined,
  }

  if (!(await provider.canSendFreeform(workspaceId, to))) {
    throw new SendError('FORA_DA_JANELA_24H', 422, 'Fora da janela de 24 h só modelos aprovados podem ser enviados')
  }

  const now = new Date()
  const pending = await db.message.create({
    data: { conversationId, direction: 'OUT', author: 'USER', body, status: 'PENDENTE', createdAt: now },
  })

  let sent
  let failure: string | null = null
  try {
    const { providerMessageId } = await provider.sendText(workspaceId, to, body)
    sent = await db.message.update({
      where: { id: pending.id },
      data: { providerMessageId, status: 'ENVIADA' },
    })
  } catch (e) {
    failure = e instanceof Error ? e.message : 'Erro desconhecido'
    sent = await db.message.update({ where: { id: pending.id }, data: { status: 'FALHOU' } })
  }

  // Regra do protótipo: enviar só assume a conversa quando a IA está ligada.
  const agent = await db.aiAgent.findUnique({ where: { workspaceId }, select: { enabled: true } })
  const takeOver = !!agent?.enabled && conversation.mode !== 'HUMANO'
  await db.conversation.update({
    where: { id: conversationId },
    data: { unread: 0, lastMessageAt: now, ...(takeOver ? { mode: 'HUMANO' as const } : {}) },
  })

  if (!failure && session.provider === 'OFICIAL') {
    const mes = monthKey(now)
    await db.usageCounter.upsert({
      where: { workspaceId_mes: { workspaceId, mes } },
      create: { workspaceId, mes, mensagensAtendimento: 1 },
      update: { mensagensAtendimento: { increment: 1 } },
    })
  }

  const item = await loadConversationItem(workspaceId, conversationId)
  if (item) emitToWorkspace(workspaceId, 'conversation.updated', { workspaceId, conversation: item })

  if (failure) throw new SendError('ENVIO_FALHOU', 502, failure)
  return toMessageDTO(sent)
}

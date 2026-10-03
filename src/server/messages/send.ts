import { db } from '@/lib/db'
import { providerToKind } from '@/lib/mappers'
import type { MessageDTO } from '@/lib/types'
import { spMonthKey } from '@/server/calendar/time'
import { cancelPendingFollowUps } from '@/server/engine/followup'
import { logError } from '@/server/engine/util'
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


// Idempotência por clientId (UUID gerado pelo cliente a cada envio). Cache EM MEMÓRIA do processo, TTL de 2 min:
// repetições (duplo clique, retry de rede) aguardam a MESMA promessa e recebem a mesma resposta.
// LIMITAÇÃO: vale para uma única instância do servidor; com várias instâncias a repetição pode cair em outra e duplicar.
const IDEMPOTENCY_TTL_MS = 120_000
const inflight = new Map<string, { promise: Promise<MessageDTO>; expires: number }>()

export function sendUserMessage(input: {
  workspaceId: string
  conversationId: string
  body: string
  clientId?: string
}): Promise<MessageDTO> {
  const { clientId, ...rest } = input
  if (!clientId) return sendUserMessageOnce(rest)

  const now = Date.now()
  for (const [k, v] of Array.from(inflight)) if (v.expires <= now) inflight.delete(k)
  const key = `${input.workspaceId}:${input.conversationId}:${clientId}`
  const hit = inflight.get(key)
  if (hit) return hit.promise

  const promise = sendUserMessageOnce(rest)
  inflight.set(key, { promise, expires: now + IDEMPOTENCY_TTL_MS })
  // Falha não fica em cache: uma nova tentativa legítima com o mesmo clientId deve poder reenviar.
  promise.catch(() => {
    if (inflight.get(key)?.promise === promise) inflight.delete(key)
  })
  return promise
}

async function sendUserMessageOnce(input: {
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

  // Resposta manual = a pessoa assumiu: a conversa fica em HUMANO (com a IA ligada ou não) e os follow-ups
  // pendentes são cancelados de vez. A automação só volta com "Devolver para IA".
  const takeOver = !failure && conversation.mode !== 'HUMANO'
  await db.conversation.update({
    where: { id: conversationId },
    data: { unread: 0, lastMessageAt: now, ...(takeOver ? { mode: 'HUMANO' as const } : {}) },
  })
  if (!failure) {
    try {
      await cancelPendingFollowUps(conversationId, 'Atendimento assumido')
    } catch (e) {
      logError('send', 'cancelar follow-ups do atendimento assumido', e)
    }
  }

  if (!failure && session.provider === 'OFICIAL') {
    const mes = spMonthKey(now)
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

import { db } from '@/lib/db'
import { providerToKind } from '@/lib/mappers'
import type { MessageDTO } from '@/lib/types'
import { spMonthKey } from '@/server/calendar/time'
import { emitToWorkspace } from '@/server/realtime/emit'
import { getProvider, WindowClosedError } from '@/server/whatsapp'
import { runProviderSend } from '@/server/engine/outbound'
import { loadConversationItem, senderFirstNames, toMessageDTO } from './dto'
import { registerManualReply } from './takeover'

export type SendErrorCode =
  | 'NAO_ENCONTRADA'
  | 'NAO_CONECTADO'
  | 'FORA_DA_JANELA_24H'
  | 'ENVIO_FALHOU'
  | 'NAO_SUPORTADO'
  | 'ARQUIVO_INVALIDO'
  | 'ARQUIVO_GRANDE'

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
  /** Equipe: quem está enviando (autoria da mensagem e atribuição automática da conversa). */
  userId?: string
}): Promise<MessageDTO> {
  const { clientId, ...rest } = input
  return withIdempotency(input.workspaceId, input.conversationId, clientId, () => sendUserMessageOnce(rest))
}

/** Executa `run` uma vez por (workspace, conversa, clientId). Sem clientId, executa sempre. Usado também pelo envio de mídia. */
export function withIdempotency(workspaceId: string, conversationId: string, clientId: string | undefined, run: () => Promise<MessageDTO>): Promise<MessageDTO> {
  if (!clientId) return run()

  const now = Date.now()
  for (const [k, v] of Array.from(inflight)) if (v.expires <= now) inflight.delete(k)
  const key = `${workspaceId}:${conversationId}:${clientId}`
  const hit = inflight.get(key)
  if (hit) return hit.promise

  const promise = run()
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
  userId?: string
}): Promise<MessageDTO> {
  const { workspaceId, conversationId, body, userId } = input

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
    data: { conversationId, direction: 'OUT', author: 'USER', body, status: 'PENDENTE', createdAt: now, senderUserId: userId ?? null },
  })

  let sent
  let failure: string | null = null
  // "Enviar" separado de "gravar o id": aceito pelo provedor nunca vira FALHOU por falha de banco; timeout/queda depois
  // de enviar fica PENDENTE "sem confirmação" (a pessoa não é induzida a reenviar e duplicar).
  const outcome = await runProviderSend(pending, () => provider.sendText(workspaceId, to, body))
  if (outcome.kind !== 'failed') {
    sent = outcome.message
  } else {
    const e = outcome.error
    if (e instanceof WindowClosedError) {
      // A Meta recusou por janela de 24 h (a conta de tempo local divergiu): nada foi enviado, não deixa mensagem.
      await db.message.delete({ where: { id: pending.id } }).catch(() => {})
      throw new SendError('FORA_DA_JANELA_24H', 422, 'Fora da janela de 24 h só modelos aprovados podem ser enviados')
    }
    failure = e instanceof Error ? e.message : 'Erro desconhecido'
    sent = await db.message.update({ where: { id: pending.id }, data: { status: 'FALHOU', failReason: failure.slice(0, 200) } })
  }

  // Resposta manual = a pessoa assumiu (regra única em takeover.ts, a mesma usada para respostas dadas pelo celular).
  if (failure) {
    await db.conversation.update({ where: { id: conversationId }, data: { unread: 0, lastMessageAt: now } })
  } else {
    await registerManualReply({ conversationId, currentMode: conversation.mode, at: now, userId })
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

  // Equipe: as outras pessoas com a conversa aberta veem a mensagem na hora (o cliente de quem enviou deduplica por id).
  const dto = toMessageDTO(sent, (await senderFirstNames([sent])).get(userId ?? ''))
  if (!failure) emitToWorkspace(workspaceId, 'message.received', { workspaceId, conversationId, message: dto })
  if (failure) throw new SendError('ENVIO_FALHOU', 502, failure)
  return dto
}

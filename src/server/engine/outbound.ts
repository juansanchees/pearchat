import { Prisma } from '@prisma/client'
import type { Message, MessageAuthor } from '@prisma/client'
import { db } from '@/lib/db'
import { loadConversationItem, senderFirstNames, toMessageDTO } from '@/server/messages/dto'
import { emitToWorkspace } from '@/server/realtime/emit'
import { getProvider, isUncertainSendError } from '@/server/whatsapp'
import type { ContactRef } from '@/server/whatsapp'
import { rememberUnrecordedSend } from './delivery-memory'
import type { ConnectedSession } from './util'
import { bumpUsage, logError, shortError } from './util'

export type OutboundContent = { kind: 'text'; text: string } | { kind: 'template'; name: string; vars: string[]; body: string }

export class OutboundError extends Error {}
/** O envio foi cancelado ANTES de chegar ao provedor (ex.: a conversa virou HUMANO). Nada foi enviado nem gravado. */
export class OutboundCancelledError extends Error {}
/** Já existe mensagem deste mesmo envio (mesma `sendKey`): não envia de novo. */
export class OutboundAlreadySentError extends Error {}

export const UNCERTAIN_NOTE = 'Envio sem confirmação do WhatsApp (verificando)'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Grava o id do provedor DEPOIS de o provedor aceitar. A mensagem JÁ saiu: uma falha de banco aqui nunca pode virar
 * FALHOU (o motor reenviaria). Tenta algumas vezes; se o banco seguir fora, guarda o id em memória para a reconciliação.
 */
async function recordAccepted(messageId: string, providerMessageId: string): Promise<Message | null> {
  const waits = [0, 300, 1_500, 4_000]
  for (const w of waits) {
    if (w) await sleep(w)
    try {
      return await db.message.update({ where: { id: messageId }, data: { providerMessageId, status: 'ENVIADA', uncertainSince: null, failReason: null } })
    } catch (e) {
      // Id já gravado por outra via (eco/status chegou antes e o vinculou a esta mesma mensagem): lê como está.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return db.message.update({ where: { id: messageId }, data: { status: 'ENVIADA', uncertainSince: null, failReason: null } }).catch(() => null)
      }
      logError('outbound', `gravar id do envio falhou (mensagem ${messageId})`, e)
    }
  }
  rememberUnrecordedSend(messageId, providerMessageId)
  return null
}

export type ProviderSendOutcome = { kind: 'sent'; message: Message } | { kind: 'uncertain'; message: Message } | { kind: 'failed'; error: unknown }

/**
 * Chama o provedor para uma mensagem PENDENTE já gravada e registra o resultado, separando "enviar" de "gravar":
 * - aceito: grava id/ENVIADA (falha de banco aqui NUNCA vira FALHOU: ver recordAccepted);
 * - incerto (timeout/queda depois de enviar): marca `uncertainSince` e devolve `uncertain` (não reenviar às cegas);
 * - recusado: devolve `failed` com o erro (quem chama grava FALHOU ou apaga, conforme o caso).
 * Usado pelo motor (sendAndRecord) e pelos envios da equipe (messages/send.ts e send-media.ts).
 */
export async function runProviderSend(pending: Message, run: () => Promise<{ providerMessageId: string }>): Promise<ProviderSendOutcome> {
  let providerMessageId: string
  try {
    providerMessageId = (await run()).providerMessageId
  } catch (e) {
    if (!isUncertainSendError(e)) return { kind: 'failed', error: e }
    const at = new Date()
    const row = await db.message
      .update({ where: { id: pending.id }, data: { uncertainSince: at, failReason: UNCERTAIN_NOTE } })
      .catch(() => ({ ...pending, uncertainSince: at, failReason: UNCERTAIN_NOTE }))
    logError('outbound', `envio sem confirmação (mensagem ${pending.id})`, e)
    return { kind: 'uncertain', message: row }
  }
  const recorded = await recordAccepted(pending.id, providerMessageId)
  return { kind: 'sent', message: recorded ?? { ...pending, providerMessageId, status: 'ENVIADA' } }
}

/**
 * Envia uma mensagem do motor (IA, disparo, follow-up, lembrete) e registra a Message OUT na conversa.
 * Não altera modo, typing nem unread: quem chama decide.
 *
 * - Recusa do provedor (nada saiu): a mensagem fica FALHOU com o motivo e lança OutboundError.
 * - Resultado INCERTO (timeout/queda depois de enviar, 2xx sem id): a mensagem fica PENDENTE com `uncertainSince` e
 *   a função DEVOLVE normalmente (quem chama trata como enviada; a IA espera a reconciliação antes de decidir reenviar).
 *   Nunca reenvia às cegas: engine/delivery.ts confirma pelo eco/status/histórico do provedor ou, sem evidência após o
 *   prazo, marca FALHOU.
 * - `sendKey`: idempotência do envio (ex.: "ai:<jobId>"): se já existe mensagem não falha com a mesma chave, lança
 *   OutboundAlreadySentError sem chamar o provedor.
 * - `guard`: revalidação imediatamente antes de enviar (ex.: conversa virou HUMANO): devolve o motivo para cancelar.
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
  sendKey?: string
  guard?: () => Promise<string | null>
}): Promise<Message> {
  const { session, conversationId, to, author, content } = input
  const { workspaceId } = session
  const body = content.kind === 'text' ? content.text : content.body

  if (input.guard) {
    const why = await input.guard()
    if (why) throw new OutboundCancelledError(why)
  }
  if (input.sendKey) {
    // Tentativa anterior que FALHOU de verdade libera a chave (a nova tentativa pode enviar).
    await db.message.updateMany({ where: { conversationId, sendKey: input.sendKey, status: 'FALHOU' }, data: { sendKey: null } })
  }
  const now = new Date()
  let pending: Message
  try {
    pending = await db.message.create({
      data: { conversationId, direction: 'OUT', author, body, status: 'PENDENTE', createdAt: now, senderUserId: input.senderUserId ?? null, sendKey: input.sendKey ?? null },
    })
  } catch (e) {
    if (input.sendKey && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new OutboundAlreadySentError('Este envio já foi feito (mesma chave)')
    }
    throw e
  }

  const provider = getProvider(session.kind)
  const outcome = await runProviderSend(pending, async () => {
    if (content.kind === 'text') return provider.sendText(workspaceId, to, content.text)
    if (!provider.sendTemplate) throw new OutboundError('Provedor sem suporte a modelos')
    return provider.sendTemplate(workspaceId, to, content.name, content.vars)
  })
  if (outcome.kind === 'failed') {
    const e = outcome.error
    // Motivo curto e legível (sem dados do cliente: os erros de provedor já vêm sem o corpo da resposta).
    await db.message.update({ where: { id: pending.id }, data: { status: 'FALHOU', failReason: shortError(e) } })
    if (input.emit !== false) {
      const item = await loadConversationItem(workspaceId, conversationId)
      if (item) emitToWorkspace(workspaceId, 'conversation.updated', { workspaceId, conversation: item })
    }
    throw new OutboundError(shortError(e))
  }
  if (outcome.kind === 'uncertain') {
    // Pode ter saído: fica PENDENTE "incerta" (nunca FALHOU aqui) e a reconciliação decide.
    await db.conversation.updateMany({ where: { id: conversationId }, data: { lastMessageAt: now } }).catch(() => undefined)
    return outcome.message
  }

  // Daqui em diante a mensagem SAIU: nenhuma falha de banco pode fazer o motor reenviar.
  const sent: Message = outcome.message
  try {
    await db.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: now } })
    if (session.official && input.countAtendimento) await bumpUsage(workspaceId, { mensagensAtendimento: 1 })
    if (input.emit !== false) {
      emitToWorkspace(workspaceId, 'message.received', { workspaceId, conversationId, message: toMessageDTO(sent, (await senderFirstNames([sent])).get(input.senderUserId ?? '')) })
      const item = await loadConversationItem(workspaceId, conversationId)
      if (item) emitToWorkspace(workspaceId, 'conversation.updated', { workspaceId, conversation: item })
    }
  } catch (e) {
    logError('outbound', `pós-envio falhou (mensagem ${pending.id}); a mensagem foi enviada`, e)
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

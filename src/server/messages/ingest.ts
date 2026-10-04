import { Prisma } from '@prisma/client'
import type { Contact } from '@prisma/client'
import { db } from '@/lib/db'
import { emitToWorkspace } from '@/server/realtime/emit'
import type { ContactRef } from '@/server/whatsapp/provider'
import { scheduleAiReply } from '@/server/engine/ai-reply'
import { registerCampaignReplies } from '@/server/engine/campaigns'
import { cancelPendingFollowUps } from '@/server/engine/followup'
import { isStopRequest } from '@/server/engine/rules'
import { logError } from '@/server/engine/util'
import { phoneCandidates } from '@/server/contacts/phone'
import { transcriptionAvailable } from '@/server/media/ai-caps'
import { sanitizeFileName } from '@/server/media/mime'
import { startInboundMedia } from '@/server/media/receive'
import { MAX_TRANSCRIBE_BYTES, MAX_TRANSCRIBE_SECONDS } from '@/server/media/transcribe'
import type { NormalizedMedia } from '@/server/whatsapp/normalize'
import { cleanText } from './api'
import { loadConversationItem, toMessageDTO } from './dto'
import { registerManualReply } from './takeover'
import { notifySpaceAttention } from '@/server/spaces/attention'
import { handleReminderReply } from '@/server/calendar/confirmation'
import { isNonReplyableBody } from '@/server/whatsapp/labels'
import { maybeQueuePhoto } from '@/server/contacts/photo'

/** Campos de mídia de uma Message nova (metadados do webhook; o arquivo vem depois). */
function mediaColumns(media: NormalizedMedia, opts: { imported: boolean; direction: 'IN' | 'OUT' }) {
  const audioIn = media.type === 'audio' && opts.direction === 'IN' && !opts.imported
  const tooLong = (media.durationSec ?? 0) > MAX_TRANSCRIBE_SECONDS || (media.size ?? 0) > MAX_TRANSCRIBE_BYTES
  return {
    mediaType: media.type,
    providerMediaId: media.providerMediaId ?? null,
    mediaMime: media.mime ?? null,
    mediaSize: media.size !== undefined && media.size <= 2_147_483_647 ? media.size : null,
    mediaName: media.name ? sanitizeFileName(media.name) : null,
    mediaDurationSec: media.durationSec !== undefined && media.durationSec <= 2_147_483_647 ? media.durationSec : null,
    // Histórico importado: só metadados, nunca baixa (a bolha mostra "Mídia não disponível").
    mediaStatus: opts.imported ? 'expirada' : 'pendente',
    transcriptStatus: audioIn ? (!tooLong && transcriptionAvailable() ? 'pendente' : 'indisponivel') : null,
  }
}

const STATUS_RANK = { PENDENTE: 0, ENVIADA: 1, ENTREGUE: 2, LIDA: 3 } as const

/** Contato do workspace pelo BSUID ou telefone (aceita o mesmo número em outro formato), sem criar nada. */
export async function findContact(workspaceId: string, from: ContactRef): Promise<Contact | null> {
  const { waUserId, telefone } = from
  let contact: Contact | null = null
  if (waUserId) contact = await db.contact.findUnique({ where: { workspaceId_waUserId: { workspaceId, waUserId } } })
  if (!contact && telefone) {
    // Mesmo número em outro formato (sem +55, com/sem o 9º dígito): não cria contato duplicado.
    const found = await db.contact.findMany({ where: { workspaceId, telefone: { in: phoneCandidates(telefone) } } })
    contact = found.find((c) => c.telefone === telefone) ?? found[0] ?? null
  }
  return contact
}

export async function findOrCreateContact(
  workspaceId: string,
  from: ContactRef,
  nome: string | undefined,
): Promise<Contact> {
  const { waUserId, telefone } = from
  const contact = await findContact(workspaceId, from)

  if (contact) {
    const patch: Prisma.ContactUpdateInput = {}
    if (waUserId && !contact.waUserId) patch.waUserId = waUserId
    if (telefone && !contact.telefone) patch.telefone = telefone
    if (nome && contact.nome === (contact.telefone ?? contact.waUserId)) patch.nome = nome
    if (!Object.keys(patch).length) return contact
    try {
      return await db.contact.update({ where: { id: contact.id }, data: patch })
    } catch (e) {
      // O telefone/LID informado já pertence a OUTRO contato do espaço (o mesmo cliente apareceu por LID e por telefone):
      // não junta nada às cegas; segue com o contato encontrado, sem a parte em conflito (a mensagem não pode se perder).
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const rest: Prisma.ContactUpdateInput = { ...patch }
        delete rest.telefone
        delete rest.waUserId
        return Object.keys(rest).length ? db.contact.update({ where: { id: contact.id }, data: rest }) : contact
      }
      throw e
    }
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
  /** Mídia recebida (imagem, áudio, vídeo, documento, figurinha): baixada em segundo plano. */
  media?: NormalizedMedia
  providerMessageId: string
  timestamp: Date
}): Promise<void> {
  const { workspaceId, from, mediaUrl, media, providerMessageId, timestamp } = input
  if (!from.waUserId && !from.telefone) return
  // NUL e surrogates soltos (vindos do celular do cliente) fariam o Postgres recusar a mensagem: saem do texto.
  const body = cleanText(input.body)
  const nome = input.nome === undefined ? undefined : cleanText(input.nome)

  const dup = await db.message.findFirst({
    where: { providerMessageId, conversation: { workspaceId } },
    select: { id: true },
  })
  if (dup) return

  const contact = await findOrCreateContact(workspaceId, from, nome)
  // Foto do WhatsApp (sem foto verificada nos últimos 7 dias): busca em segundo plano, fora do caminho da mensagem.
  maybeQueuePhoto(workspaceId, contact)

  // Pedido de saída ("parar", "pare", "não quero mais receber", "me tira da lista"...): vale com a IA ligada ou
  // desligada. A detecção normaliza acento/pontuação e evita falso positivo ("vou parar aí na loja").
  let optOut = contact.optOut
  if (!contact.optOut && isStopRequest(body)) {
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
      ...(media ? mediaColumns(media, { imported: false, direction: 'IN' }) : {}),
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
  void notifySpaceAttention(workspaceId)
  if (media) startInboundMedia(message.id, media.inlineBase64)
  // Resposta a um lembrete de agendamento ("1" confirma, "2" remarca): tratada aqui, sem acionar a IA para a mesma mensagem.
  if (!media && !optOut) {
    const lembrete = await handleReminderReply({ workspaceId, conversationId: conversation.id, contactId: contact.id, text: body, optOut })
    if (lembrete.handled) return
  }
  // Chamada, enquete, convite, tipo desconhecido: aparecem na conversa, mas a IA não responde a eles.
  if (!media && isNonReplyableBody(body)) return
  await scheduleAiReply({ workspaceId, conversationId: conversation.id, optOut })
}

/** Quanto tempo uma mensagem enviada pelo PearChat fica "em voo" (gravada como PENDENTE, ainda sem id do provedor). */
const IN_FLIGHT_MS = 120_000

/**
 * Mensagem que o DONO enviou direto pelo celular (webhook `messages.upsert` com `fromMe`).
 *
 * - NÃO duplica o que o próprio PearChat enviou (app, IA, follow-up, disparo, lembrete): confere pelo id do
 *   provedor e, para a corrida em que o webhook chega ANTES de o envio gravar o id, também por uma mensagem
 *   nossa ainda PENDENTE, sem id, com o mesmo texto na mesma conversa (tudo numa consulta só, sem janela entre as duas).
 * - `takeOver` = resposta manual de verdade (regra única de takeover.ts). Mensagens antigas (histórico que chega
 *   pelo upsert) são só gravadas, marcadas como importadas: o motor não age sobre elas e não assumem a conversa.
 */
export async function ingestOutboundFromPhone(input: {
  workspaceId: string
  to: ContactRef
  body: string
  providerMessageId: string
  timestamp: Date
  takeOver: boolean
  media?: NormalizedMedia
}): Promise<'recorded' | 'duplicate' | 'ignored'> {
  const { workspaceId, to, providerMessageId, timestamp, takeOver, media } = input
  if (!to.waUserId && !to.telefone) return 'ignored'
  const body = cleanText(input.body)
  if (!body.trim()) return 'ignored'

  // Só pode haver envio nosso em voo para um contato que já existe.
  const existing = await findContact(workspaceId, to)
  const existingConv = existing ? await db.conversation.findUnique({ where: { contactId: existing.id }, select: { id: true } }) : null
  const dup = await db.message.findFirst({
    where: {
      OR: [
        { providerMessageId, conversation: { workspaceId } },
        ...(existingConv
          ? [
              {
                conversationId: existingConv.id,
                direction: 'OUT' as const,
                status: 'PENDENTE' as const,
                providerMessageId: null,
                body,
                ...(media ? { mediaType: media.type } : {}),
                createdAt: { gte: new Date(Date.now() - IN_FLIGHT_MS) },
              },
            ]
          : []),
      ],
    },
    select: { id: true },
  })
  if (dup) return 'duplicate'

  const contact = existing ?? (await findOrCreateContact(workspaceId, to, undefined))
  const conversation = await db.conversation.upsert({
    where: { contactId: contact.id },
    create: { workspaceId, contactId: contact.id },
    update: {},
  })

  let message
  try {
    message = await db.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'OUT',
        author: 'USER',
        body,
        ...(media ? mediaColumns(media, { imported: !takeOver, direction: 'OUT' }) : {}),
        status: 'ENVIADA',
        providerMessageId,
        imported: !takeOver,
        createdAt: timestamp,
      },
    })
  } catch (e) {
    // Webhook repetido (ou o envio nosso gravou o mesmo id um instante antes): já está registrado.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return 'duplicate'
    throw e
  }

  if (takeOver) {
    await registerManualReply({ conversationId: conversation.id, currentMode: conversation.mode, at: timestamp })
  } else {
    await db.conversation.updateMany({
      where: { id: conversation.id, OR: [{ lastMessageAt: null }, { lastMessageAt: { lt: timestamp } }] },
      data: { lastMessageAt: timestamp },
    })
  }

  emitToWorkspace(workspaceId, 'message.received', { workspaceId, conversationId: conversation.id, message: toMessageDTO(message) })
  const item = await loadConversationItem(workspaceId, conversation.id)
  if (item) emitToWorkspace(workspaceId, 'conversation.updated', { workspaceId, conversation: item })
  void notifySpaceAttention(workspaceId)
  if (media && takeOver) startInboundMedia(message.id, media.inlineBase64)
  return 'recorded'
}

export async function updateMessageStatus(input: {
  workspaceId: string
  providerMessageId: string
  status: 'enviada' | 'entregue' | 'lida' | 'falhou'
  /** Motivo da falha informado pelo provedor (só quando status = falhou). */
  reason?: string
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

  await db.message.update({ where: { id: msg.id }, data: { status: next, ...(next === 'FALHOU' && input.reason ? { failReason: input.reason.slice(0, 200) } : {}) } })
  emitToWorkspace(workspaceId, 'message.status', {
    workspaceId,
    conversationId: msg.conversationId,
    messageId: msg.id,
    status,
  })
}

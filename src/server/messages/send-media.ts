import { db } from '@/lib/db'
import { providerToKind } from '@/lib/mappers'
import type { MessageDTO } from '@/lib/types'
import { spMonthKey } from '@/server/calendar/time'
import { MAX_OUTBOUND_BYTES, MEDIA_LABEL, sanitizeFileName, validateMedia } from '@/server/media/mime'
import { buildMediaKey, getMediaStore } from '@/server/media/store'
import { emitToWorkspace } from '@/server/realtime/emit'
import { getProvider, ProviderUnsupportedError, WindowClosedError } from '@/server/whatsapp'
import { cleanText } from './api'
import { loadConversationItem, toMessageDTO } from './dto'
import { SendError, withIdempotency } from './send'
import { registerManualReply } from './takeover'

export const MAX_CAPTION_CHARS = 1024

export type OutboundFile = { data: Buffer; name: string; mime: string }

/**
 * Envio de mídia pelo atendente (imagem, áudio, vídeo, documento). Mesmas regras do texto: idempotente por clientId,
 * conta como resposta manual (assume a conversa) e respeita a janela de 24 h da API oficial.
 */
export function sendUserMedia(input: {
  workspaceId: string
  conversationId: string
  file: OutboundFile
  caption?: string
  clientId?: string
}): Promise<MessageDTO> {
  const { workspaceId, conversationId, clientId } = input
  return withIdempotency(workspaceId, conversationId, clientId, () => sendOnce(input))
}

async function sendOnce(input: { workspaceId: string; conversationId: string; file: OutboundFile; caption?: string }): Promise<MessageDTO> {
  const { workspaceId, conversationId, file } = input

  if (file.data.length === 0) throw new SendError('ARQUIVO_INVALIDO', 400, 'O arquivo está vazio')
  if (file.data.length > MAX_OUTBOUND_BYTES) throw new SendError('ARQUIVO_GRANDE', 413, 'O arquivo passa do limite de 16 MB')
  // O tipo vem do CONTEÚDO (assinatura), não do que o navegador declarou.
  const v = validateMedia({ declaredMime: file.mime, fileName: file.name, head: file.data.subarray(0, 4096) })
  if (!v.ok) throw new SendError('ARQUIVO_INVALIDO', 415, v.reason)
  const type = v.kind === 'sticker' ? 'image' : v.kind
  const fileName = sanitizeFileName(file.name, v.ext)
  // Áudio não tem legenda no WhatsApp.
  const caption = type === 'audio' ? '' : cleanText(input.caption ?? '').trim().slice(0, MAX_CAPTION_CHARS)

  const conversation = await db.conversation.findFirst({ where: { id: conversationId, workspaceId }, include: { contact: true } })
  if (!conversation) throw new SendError('NAO_ENCONTRADA', 404, 'Conversa não encontrada')
  const session = await db.whatsAppSession.findUnique({ where: { workspaceId } })
  if (!session || session.status !== 'CONECTADO' || !session.provider) throw new SendError('NAO_CONECTADO', 409, 'WhatsApp não está conectado')

  const provider = getProvider(providerToKind(session.provider))
  const to = { waUserId: conversation.contact.waUserId ?? undefined, telefone: conversation.contact.telefone ?? undefined }
  if (!(await provider.canSendFreeform(workspaceId, to))) {
    throw new SendError('FORA_DA_JANELA_24H', 422, 'Fora da janela de 24 h só modelos aprovados podem ser enviados')
  }
  const send = type === 'audio' ? provider.sendAudio?.bind(provider) : provider.sendMedia?.bind(provider)
  if (!send) throw new SendError('NAO_SUPORTADO', 422, 'Esta conexão ainda não envia arquivos')

  const key = buildMediaKey(workspaceId, v.ext)
  await getMediaStore().put(key, file.data, { mime: v.mime }, { maxBytes: MAX_OUTBOUND_BYTES })

  const now = new Date()
  const pending = await db.message.create({
    data: {
      conversationId,
      direction: 'OUT',
      author: 'USER',
      body: caption || MEDIA_LABEL[type],
      status: 'PENDENTE',
      createdAt: now,
      mediaType: type,
      mediaMime: v.mime,
      mediaSize: file.data.length,
      mediaName: fileName,
      mediaKey: key,
      mediaStatus: 'ok',
    },
  })

  let sent
  let failure: string | null = null
  try {
    const { providerMessageId } = await send(workspaceId, to, { type, mime: v.mime, fileName, ...(caption ? { caption } : {}), data: file.data })
    sent = await db.message.update({ where: { id: pending.id }, data: { providerMessageId, status: 'ENVIADA' } })
  } catch (e) {
    if (e instanceof ProviderUnsupportedError) {
      // Nada foi enviado: não deixa mensagem nem arquivo para trás.
      await db.message.delete({ where: { id: pending.id } }).catch(() => {})
      await getMediaStore().delete(key)
      throw new SendError('NAO_SUPORTADO', 422, e.message)
    }
    if (e instanceof WindowClosedError) {
      await db.message.delete({ where: { id: pending.id } }).catch(() => {})
      await getMediaStore().delete(key)
      throw new SendError('FORA_DA_JANELA_24H', 422, 'Fora da janela de 24 h só modelos aprovados podem ser enviados')
    }
    failure = e instanceof Error ? e.message : 'Erro desconhecido'
    sent = await db.message.update({ where: { id: pending.id }, data: { status: 'FALHOU', failReason: failure.slice(0, 200) } })
  }

  if (failure) {
    await db.conversation.update({ where: { id: conversationId }, data: { unread: 0, lastMessageAt: now } })
  } else {
    await registerManualReply({ conversationId, currentMode: conversation.mode, at: now })
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

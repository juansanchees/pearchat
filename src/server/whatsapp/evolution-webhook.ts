import { db } from '@/lib/db'
import { statusToKind } from '@/lib/mappers'
import { reconcileOwnEcho } from '@/server/engine/delivery'
import { log } from '@/server/engine/util'
import { ingestInboundMessage, ingestOutboundFromPhone, updateMessageStatus } from '@/server/messages/ingest'
import { getProvider } from '@/server/whatsapp'
import { queueHistoryMessages } from './history-import'
import { normalizeEvolutionEvent } from './normalize'
import type { EvolutionEvent } from './normalize'
import { disableAutomationsDefinitively, setStatus } from './session'
import { arrivalForOrdering, BatchFailure, eachIsolated, phoneReplyTakesOver } from './webhook-common'

// Processamento dos eventos da Evolution (a partir da caixa de entrada: webhook-inbox). Nunca loga corpo nem telefone.

/**
 * Códigos de desconexão DEFINITIVA do Baileys/Evolution 2.3.7 (a própria Evolution não reconecta com eles):
 * 401 loggedOut (sessão encerrada no celular), 403 forbidden, 402 e 406 (conta banida/bloqueada).
 * Qualquer outro `close` (428 conexão fechada, 408 timeout, 515 reinício, 440 substituída, 500...) é passageiro:
 * a Evolution reconecta sozinha e as automações só ficam PAUSADAS enquanto o status não é CONECTADO.
 */
export const DEFINITIVE_DISCONNECT_CODES = new Set([401, 402, 403, 406])

export const isDefinitiveDisconnect = (reason: number | undefined): boolean => reason !== undefined && DEFINITIVE_DISCONNECT_CODES.has(reason)

/** Evento de conexão processado mais de 5 s depois de chegar = reprocessamento (ver handleEvolutionEvent). */
const STALE_CONNECTION_EVENT_MS = 5_000

/** Tratador da caixa de entrada para o provedor "evolution". Lança se algo falhou (a caixa repete; tudo é idempotente). */
export async function handleEvolutionPayload(json: unknown, ctx: { receivedAt: Date }): Promise<void> {
  await handleEvolutionEvent(normalizeEvolutionEvent(json), ctx)
}

export async function handleEvolutionEvent(event: EvolutionEvent, ctx: { receivedAt: Date }): Promise<void> {
  if (event.kind === 'ignored') return
  const session = await db.whatsAppSession.findFirst({
    where: { evolutionInstance: event.instance },
    select: { workspaceId: true, status: true, numero: true, connectedAt: true, updatedAt: true },
  })
  if (!session) return
  // Evento de conexão ATRASADO (reprocessado da caixa de entrada depois de uma falha) não desfaz um estado mais novo:
  // um "close" velho aplicado depois do "open" deixaria as automações pausadas com o WhatsApp conectado.
  if (event.kind === 'connection' && Date.now() - ctx.receivedAt.getTime() > STALE_CONNECTION_EVENT_MS && session.updatedAt > ctx.receivedAt) {
    log('wa', `evento de conexão atrasado ignorado (instância ${event.instance}): já há estado mais novo`)
    return
  }
  const { workspaceId } = session
  const current = statusToKind(session.status)
  const failures: unknown[] = []
  let total = 0

  switch (event.kind) {
    case 'qr':
      if (current !== 'conectado') await setStatus(workspaceId, 'aguardando_qr', { qr: event.qr })
      return
    case 'connection':
      if (event.status === 'conectado') {
        const numero = await getProvider('rapida')
          .fetchNumero?.(workspaceId)
          .catch(() => undefined)
        await setStatus(workspaceId, 'conectado', { numero: numero ?? session.numero })
        // Queda passageira: IA, follow-up e disparos NUNCA foram desligados; voltam a agir sozinhos agora que está CONECTADO.
        if (current === 'desconectado') log('wa', `workspace ${workspaceId}: reconectou; automações retomadas`)
      } else if (event.status === 'desconectado') {
        // Enquanto espera a leitura do QR a Evolution também reporta "close": não derruba a tela do QR.
        if (current === 'conectado' || current === 'conectando') {
          await setStatus(workspaceId, 'desconectado')
          if (isDefinitiveDisconnect(event.reason)) {
            await disableAutomationsDefinitively(workspaceId, `sessão encerrada no WhatsApp (código ${event.reason})`)
          } else {
            // Pausa derivada do status (nada é gravado como desligado): ao reconectar tudo volta sozinho.
            log('wa', `workspace ${workspaceId}: queda de conexão (código ${event.reason ?? '-'}); automações pausadas até reconectar`)
          }
        }
      } else if (current !== 'aguardando_qr' && current !== 'conectado') {
        // "connecting" durante a espera do QR é ambíguo: mantém aguardando_qr.
        await setStatus(workspaceId, 'conectando')
      }
      return
    case 'messages':
      total = event.inbound.length + event.outbound.length
      await eachIsolated(
        event.inbound,
        async (m) => {
          if (m.unsupportedKeys) log('wa', `tipo de mensagem não suportado recebido (campos: ${m.unsupportedKeys.join(',')})`)
          await ingestInboundMessage({
            workspaceId,
            from: m.from,
            nome: m.nome,
            body: m.body,
            providerMessageId: m.providerMessageId,
            timestamp: m.timestamp,
            receivedAt: arrivalForOrdering(ctx.receivedAt),
            media: m.media,
          })
        },
        failures,
      )
      // Mensagens `fromMe`: respostas dadas pelo celular do dono (ou o eco de um envio nosso, que o ingest reconhece).
      await eachIsolated(
        event.outbound,
        async (m) => {
          await ingestOutboundFromPhone({
            workspaceId,
            to: m.to,
            body: m.body,
            providerMessageId: m.providerMessageId,
            timestamp: m.timestamp,
            receivedAt: arrivalForOrdering(ctx.receivedAt),
            takeOver: phoneReplyTakesOver(m.timestamp, session.connectedAt),
            media: m.media,
          })
        },
        failures,
      )
      break
    case 'sent':
      // Eco SEND_MESSAGE: SEMPRE um envio feito pela API (o PearChat). Só confirma envio sem id; nunca assume a conversa.
      total = event.sent.length
      await eachIsolated(event.sent, async (m) => void (await reconcileOwnEcho(workspaceId, m)), failures)
      break
    case 'history':
      // Histórico do pareamento: grava em lote, sem acionar IA/follow-up/campanhas.
      queueHistoryMessages(workspaceId, event.messages)
      return
    case 'status':
      total = event.updates.length
      await eachIsolated(
        event.updates,
        (u) => updateMessageStatus({ workspaceId, providerMessageId: u.providerMessageId, status: u.status }),
        failures,
      )
      break
  }
  if (failures.length) throw new BatchFailure(failures.length, total, failures[0])
}

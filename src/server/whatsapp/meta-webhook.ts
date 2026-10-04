import { db } from '@/lib/db'
import { logError } from '@/server/engine/util'
import { findOrCreateContact, ingestInboundMessage, ingestOutboundFromPhone, updateMessageStatus } from '@/server/messages/ingest'
import { queueHistoryMessages } from './history-import'
import { normalizeMetaPayload, parseMetaChanges, parseMetaHistory } from './normalize'
import type { MetaChange } from './normalize'
import { onlyDigits, toE164 } from './phone'
import { disableAutomations, readSessionData, setStatus } from './session'
import { applyTemplateStatusEvent } from './templates'

// Processamento dos webhooks da Meta (depois de a rota já ter respondido 200). Nunca loga corpo de mensagem, telefone nem token.

/** Resposta do celular mais velha que isto não assume a conversa (é tratada como histórico). */
const OUTBOUND_TAKEOVER_MAX_AGE_MS = 10 * 60_000
const PARTNER_EVENT_TTL_MS = 7 * 24 * 3_600_000

const g = globalThis as unknown as { __pearchat_meta_queue?: Promise<void> }

/** Fila única por processo: mantém a ordem (mensagem antes do status) e não estoura o pool do banco. */
export function enqueueMetaPayload(json: unknown): Promise<void> {
  const prev = g.__pearchat_meta_queue ?? Promise.resolve()
  const next = prev.then(() => processMetaPayload(json)).catch((e) => logError('meta-webhook', 'falha ao processar o lote', e))
  g.__pearchat_meta_queue = next
  return next
}

async function sessionByPhone(phoneNumberId: string) {
  return db.whatsAppSession.findFirst({
    where: { metaPhoneNumberId: phoneNumberId, provider: 'OFICIAL' },
    select: { workspaceId: true, connectedAt: true, status: true },
  })
}

export async function processMetaPayload(json: unknown): Promise<void> {
  // 1) mensagens, status e ecos do celular
  for (const batch of normalizeMetaPayload(json)) {
    try {
      const session = await sessionByPhone(batch.phoneNumberId)
      if (!session) continue // número desconhecido: 200 sem efeito
      const { workspaceId } = session
      for (const m of batch.inbound) {
        await ingestInboundMessage({
          workspaceId,
          from: m.from,
          nome: m.nome,
          body: m.body,
          providerMessageId: m.providerMessageId,
          timestamp: m.timestamp,
          media: m.media,
        })
      }
      for (const m of batch.echoes) {
        const age = Date.now() - m.timestamp.getTime()
        const afterConnect = !session.connectedAt || m.timestamp.getTime() >= session.connectedAt.getTime() - 60_000
        await ingestOutboundFromPhone({
          workspaceId,
          to: m.to,
          body: m.body,
          providerMessageId: m.providerMessageId,
          timestamp: m.timestamp,
          takeOver: age < OUTBOUND_TAKEOVER_MAX_AGE_MS && afterConnect,
          media: m.media,
        })
      }
      for (const s of batch.statuses) {
        if (s.status === 'falhou') console.error(`[wa/meta] mensagem falhou (código ${s.errorCode ?? '-'})`)
        await updateMessageStatus({
          workspaceId,
          providerMessageId: s.providerMessageId,
          status: s.status,
          ...(s.status === 'falhou' ? { reason: `${s.errorTitle ?? 'Falha na entrega'}${s.errorCode ? ` (código ${s.errorCode})` : ''}` } : {}),
        })
      }
    } catch (e) {
      logError('meta-webhook', 'lote de mensagens', e)
    }
  }

  // 2) demais campos
  for (const change of parseMetaChanges(json)) {
    try {
      await handleChange(change)
    } catch (e) {
      logError('meta-webhook', `campo ${change.field}`, e)
    }
  }
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : typeof v === 'number' ? String(v) : undefined)
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

async function handleChange(change: MetaChange): Promise<void> {
  switch (change.field) {
    case 'account_update':
      return handleAccountUpdate(change)
    case 'message_template_status_update':
      return void (await applyTemplateStatusEvent(change.wabaId ?? '', {
        event: str(change.value.event),
        id: str(change.value.message_template_id),
        name: str(change.value.message_template_name),
        language: str(change.value.message_template_language),
        reason: str(change.value.reason),
      }))
    case 'history':
      return handleHistory(change)
    case 'smb_app_state_sync':
      return handleStateSync(change)
    default:
      return
  }
}

const PARTNER_ADDED = new Set(['PARTNER_ADDED', 'PARTNER_APP_INSTALLED'])
const DISCONNECTED = new Set(['PARTNER_REMOVED', 'PARTNER_APP_UNINSTALLED', 'ACCOUNT_DELETED', 'DISABLED_UPDATE', 'ACCOUNT_VIOLATION', 'ACCOUNT_OFFBOARDED', 'ACCOUNT_DISCONNECTED'])
const RESTRICTED = new Set(['ACCOUNT_RESTRICTION'])

async function handleAccountUpdate(change: MetaChange): Promise<void> {
  const event = (str(change.value.event) ?? '').toUpperCase()
  const info = rec(change.value.waba_info)
  const wabaId = str(info.waba_id) ?? change.wabaId
  if (!wabaId) return

  if (PARTNER_ADDED.has(event)) {
    // Cadastro concluído (principalmente no fluxo hospedado): fica à espera de o workspace reivindicar.
    const businessId = str(info.owner_business_id) ?? null
    await db.metaPartnerEvent.create({ data: { wabaId, businessId, event } })
    await db.metaPartnerEvent.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - PARTNER_EVENT_TTL_MS) } } }).catch(() => {})
    return
  }

  const sessions = await db.whatsAppSession.findMany({ where: { metaWabaId: wabaId, provider: 'OFICIAL' }, select: { workspaceId: true, status: true } })
  if (DISCONNECTED.has(event) || RESTRICTED.has(event)) {
    for (const s of sessions) {
      if (s.status === 'DESCONECTADO') continue
      await setStatus(s.workspaceId, DISCONNECTED.has(event) ? 'desconectado' : 'erro')
      await db.whatsAppSession.update({ where: { workspaceId: s.workspaceId }, data: { metaLastError: `Aviso da Meta: ${event}` } })
      await disableAutomations(s.workspaceId)
    }
    return
  }
  if (event === 'ACCOUNT_RECONNECTED') {
    for (const s of sessions) {
      if (s.status === 'ERRO') {
        await setStatus(s.workspaceId, 'conectado')
        await db.whatsAppSession.update({ where: { workspaceId: s.workspaceId }, data: { metaLastError: null } })
      }
    }
  }
}

/** Coexistence: histórico enviado pela Meta, gravado em lote como importado (sem IA, follow-up ou campanhas). */
async function handleHistory(change: MetaChange): Promise<void> {
  const h = parseMetaHistory(change.value)
  if (!h.phoneNumberId) return
  const session = await sessionByPhone(h.phoneNumberId)
  if (!session) return
  if (h.declined) return
  // Preferência do passo 3: só "não importar" (false) bloqueia; ainda sem escolha (undefined) aceita.
  if ((await readSessionData(session.workspaceId)).importarHistorico === false) return
  if (h.messages.length) queueHistoryMessages(session.workspaceId, h.messages)
}

/** Coexistence: contatos do app WhatsApp Business (smb_app_state_sync). */
async function handleStateSync(change: MetaChange): Promise<void> {
  const phoneNumberId = str(rec(change.value.metadata).phone_number_id)
  if (!phoneNumberId) return
  const session = await sessionByPhone(phoneNumberId)
  if (!session) return
  if ((await readSessionData(session.workspaceId)).importarHistorico === false) return
  const items = Array.isArray(change.value.state_sync) ? change.value.state_sync : []
  for (const it of items) {
    const o = rec(it)
    if (str(o.type) !== 'contact') continue
    const action = (str(o.action) ?? '').toLowerCase()
    if (action === 'remove') continue
    const c = rec(o.contact)
    const phone = str(c.phone_number)
    if (!phone || onlyDigits(phone).length < 8) continue
    const nome = str(c.full_name) ?? str(c.first_name)
    await findOrCreateContact(session.workspaceId, { telefone: toE164(phone) }, nome)
  }
}

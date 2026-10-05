import { db } from '@/lib/db'
import { logError } from '@/server/engine/util'
import { findOrCreateContact, ingestInboundMessage, ingestOutboundFromPhone, updateMessageStatus } from '@/server/messages/ingest'
import { queueHistoryMessages } from './history-import'
import { normalizeMetaPayload, parseMetaChanges, parseMetaHistory } from './normalize'
import type { MetaChange } from './normalize'
import { onlyDigits, toE164 } from './phone'
import { disableAutomationsDefinitively, readSessionData, setStatus } from './session'
import { applyTemplateStatusEvent } from './templates'
import { BatchFailure, eachIsolated, phoneReplyTakesOver } from './webhook-common'

// Processamento dos webhooks da Meta a partir da caixa de entrada (WebhookInbox: a rota grava antes de responder 200).
// Nunca loga corpo de mensagem, telefone nem token.

const PARTNER_EVENT_TTL_MS = 7 * 24 * 3_600_000

async function sessionByPhone(phoneNumberId: string) {
  return db.whatsAppSession.findFirst({
    where: { metaPhoneNumberId: phoneNumberId, provider: 'OFICIAL' },
    select: { workspaceId: true, connectedAt: true, status: true },
  })
}

/** Tratador da caixa de entrada para o provedor "meta". Lança se algo falhou (a caixa repete; tudo é idempotente). */
export async function handleMetaPayload(json: unknown, ctx: { receivedAt: Date }): Promise<void> {
  await processMetaPayload(json, ctx)
}

/**
 * Processa um payload. Cada mensagem/status/campo é isolado: uma falha não impede as demais; no fim, se algo falhou,
 * lança (a caixa de entrada repete o payload inteiro; o que já entrou é absorvido pela idempotência por id).
 */
export async function processMetaPayload(json: unknown, ctx: { receivedAt?: Date } = {}): Promise<void> {
  const failures: unknown[] = []
  let total = 0
  const receivedAt = ctx.receivedAt ?? new Date()
  // 1) mensagens, status e ecos do celular
  for (const batch of normalizeMetaPayload(json)) {
    total += batch.inbound.length + batch.echoes.length + batch.statuses.length
    let session: Awaited<ReturnType<typeof sessionByPhone>>
    try {
      session = await sessionByPhone(batch.phoneNumberId)
    } catch (e) {
      failures.push(e)
      continue
    }
    if (!session) continue // número desconhecido: sem efeito
    const { workspaceId, connectedAt } = session
    await eachIsolated(
      batch.inbound,
      (m) =>
        ingestInboundMessage({
          workspaceId,
          from: m.from,
          nome: m.nome,
          body: m.body,
          providerMessageId: m.providerMessageId,
          timestamp: m.timestamp,
          receivedAt,
          media: m.media,
        }),
      failures,
    )
    await eachIsolated(
      batch.echoes,
      async (m) => {
        await ingestOutboundFromPhone({
          workspaceId,
          to: m.to,
          body: m.body,
          providerMessageId: m.providerMessageId,
          timestamp: m.timestamp,
          receivedAt,
          takeOver: phoneReplyTakesOver(m.timestamp, connectedAt),
          media: m.media,
        })
      },
      failures,
    )
    await eachIsolated(
      batch.statuses,
      async (s) => {
        if (s.status === 'falhou') console.error(`[wa/meta] mensagem falhou (código ${s.errorCode ?? '-'})`)
        await updateMessageStatus({
          workspaceId,
          providerMessageId: s.providerMessageId,
          status: s.status,
          ...(s.status === 'falhou' ? { reason: `${s.errorTitle ?? 'Falha na entrega'}${s.errorCode ? ` (código ${s.errorCode})` : ''}` } : {}),
        })
      },
      failures,
    )
  }

  // 2) demais campos
  for (const change of parseMetaChanges(json)) {
    try {
      await handleChange(change)
    } catch (e) {
      logError('meta-webhook', `campo ${change.field}`, e)
      failures.push(e)
    }
    total++
  }
  if (failures.length) throw new BatchFailure(failures.length, total, failures[0])
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
      // Aviso da Meta (conta removida/restrita) é definitivo: desliga e avisa.
      await disableAutomationsDefinitively(s.workspaceId, `aviso da Meta ${event}`)
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

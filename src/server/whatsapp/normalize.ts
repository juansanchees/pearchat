import { z } from 'zod'
import type { ConnectionStatusKind, MessageStatusKind } from '@/lib/types'
import { onlyDigits, toE164 } from './phone'
import type { ContactRef } from './provider'

// Normalização dos webhooks (Meta e Evolution) em tipos comuns. Funções puras: sem I/O.

export type NormalizedInbound = {
  from: ContactRef
  nome?: string
  body: string
  providerMessageId: string
  timestamp: Date
}
/** Status que vêm dos provedores; 'pendente' é só interno e nunca chega por webhook. */
export type DeliveryStatus = Exclude<MessageStatusKind, 'pendente'>
export type NormalizedStatus = { providerMessageId: string; status: DeliveryStatus }

const obj = z.object({}).passthrough()
const str = z.string()

function secondsToDate(v: unknown): Date {
  const n = typeof v === 'string' || typeof v === 'number' ? Number(v) : NaN
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : new Date()
}

// ---------------------------------------------------------------- Meta

const metaMessage = z
  .object({
    id: str,
    from: str.optional(),
    from_user_id: str.optional(),
    user_id: str.optional(),
    timestamp: z.union([str, z.number()]).optional(),
    type: str.optional(),
    text: z.object({ body: str }).passthrough().optional(),
  })
  .passthrough()

const metaStatus = z.object({ id: str, status: str }).passthrough()

const metaValue = z
  .object({
    metadata: z.object({ phone_number_id: str }).passthrough(),
    contacts: z
      .array(
        z
          .object({
            wa_id: str.optional(),
            user_id: str.optional(),
            profile: z.object({ name: str.optional() }).passthrough().optional(),
          })
          .passthrough(),
      )
      .optional(),
    messages: z.array(obj).optional(),
    statuses: z.array(obj).optional(),
  })
  .passthrough()

const metaEnvelope = z
  .object({
    entry: z.array(z.object({ changes: z.array(z.object({ value: obj }).passthrough()).optional() }).passthrough()),
  })
  .passthrough()

const META_PLACEHOLDER: Record<string, string> = {
  image: '[Imagem]',
  audio: '[Áudio]',
  video: '[Vídeo]',
  document: '[Documento]',
  sticker: '[Figurinha]',
  location: '[Localização]',
  contacts: '[Contato]',
  button: '[Resposta de botão]',
  interactive: '[Resposta interativa]',
  reaction: '[Reação]',
}

export function mapMetaStatus(s: string): DeliveryStatus | null {
  switch (s) {
    case 'sent':
      return 'enviada'
    case 'delivered':
      return 'entregue'
    case 'read':
      return 'lida'
    case 'failed':
      return 'falhou'
    default:
      return null
  }
}

export type MetaBatch = { phoneNumberId: string; inbound: NormalizedInbound[]; statuses: NormalizedStatus[] }

/** Payload do webhook da Meta -> lotes por phone_number_id. Entradas inválidas são ignoradas. */
export function normalizeMetaPayload(json: unknown): MetaBatch[] {
  const env = metaEnvelope.safeParse(json)
  if (!env.success) return []
  const batches: MetaBatch[] = []
  for (const entry of env.data.entry) {
    for (const change of entry.changes ?? []) {
      const v = metaValue.safeParse(change.value)
      if (!v.success) continue
      const { metadata, contacts = [], messages = [], statuses = [] } = v.data
      const inbound: NormalizedInbound[] = []
      for (const raw of messages) {
        const m = metaMessage.safeParse(raw)
        if (!m.success) continue
        const msg = m.data
        // Contato correspondente: por wa_id (telefone) ou por user_id (BSUID).
        const contact =
          contacts.find((c) => (msg.from && c.wa_id === msg.from) || (msg.from_user_id && c.user_id === msg.from_user_id)) ??
          (contacts.length === 1 ? contacts[0] : undefined)
        const waUserId = contact?.user_id ?? msg.from_user_id ?? msg.user_id
        const phoneRaw = contact?.wa_id ?? msg.from
        const telefone = phoneRaw && onlyDigits(phoneRaw).length >= 8 ? toE164(phoneRaw) : undefined
        if (!telefone && !waUserId) continue
        const body = msg.type === 'text' || msg.text ? (msg.text?.body ?? '') : (META_PLACEHOLDER[msg.type ?? ''] ?? '[Mensagem não suportada]')
        if (msg.type === 'reaction') continue
        inbound.push({
          from: { ...(waUserId ? { waUserId } : {}), ...(telefone ? { telefone } : {}) },
          ...(contact?.profile?.name ? { nome: contact.profile.name } : {}),
          body,
          providerMessageId: msg.id,
          timestamp: secondsToDate(msg.timestamp),
        })
      }
      const st: NormalizedStatus[] = []
      for (const raw of statuses) {
        const s = metaStatus.safeParse(raw)
        if (!s.success) continue
        const status = mapMetaStatus(s.data.status)
        if (status) st.push({ providerMessageId: s.data.id, status })
      }
      if (inbound.length || st.length) batches.push({ phoneNumberId: metadata.phone_number_id, inbound, statuses: st })
    }
  }
  return batches
}

// ---------------------------------------------------------------- Evolution

export type EvolutionEvent =
  | { kind: 'qr'; instance: string; qr: string }
  | { kind: 'connection'; instance: string; status: ConnectionStatusKind }
  | { kind: 'messages'; instance: string; inbound: NormalizedInbound[] }
  | { kind: 'status'; instance: string; updates: NormalizedStatus[] }
  | { kind: 'ignored' }

const evoEnvelope = z.object({ event: str, instance: str, data: z.unknown().optional() }).passthrough()

export function mapEvolutionConnection(state: string): ConnectionStatusKind {
  if (state === 'open') return 'conectado'
  if (state === 'connecting') return 'conectando'
  return 'desconectado'
}

export function mapEvolutionMessageStatus(s: string): DeliveryStatus | null {
  switch (s.toUpperCase()) {
    case 'SERVER_ACK':
      return 'enviada'
    case 'DELIVERY_ACK':
      return 'entregue'
    case 'READ':
    case 'PLAYED':
      return 'lida'
    case 'ERROR':
      return 'falhou'
    default:
      return null
  }
}

const evoKey = z
  .object({ remoteJid: str, fromMe: z.boolean().optional(), id: str, remoteJidAlt: str.optional(), senderPn: str.optional() })
  .passthrough()

const evoMessage = z
  .object({
    key: evoKey,
    pushName: str.optional(),
    messageTimestamp: z.union([str, z.number()]).optional(),
    message: z
      .object({
        conversation: str.optional(),
        extendedTextMessage: z.object({ text: str.optional() }).passthrough().optional(),
      })
      .passthrough()
      .nullish(),
  })
  .passthrough()

function jidToRef(jid: string, alt?: string): ContactRef | null {
  const [user = '', host = ''] = jid.split('@')
  if (host === 'lid') {
    const phoneJid = alt && alt.endsWith('@s.whatsapp.net') ? alt.split('@')[0] : undefined
    const telefone = phoneJid && onlyDigits(phoneJid).length >= 8 ? toE164(phoneJid) : undefined
    return { waUserId: user, ...(telefone ? { telefone } : {}) }
  }
  if (host === 's.whatsapp.net') {
    return onlyDigits(user).length >= 8 ? { telefone: toE164(user) } : null
  }
  return null // grupos (@g.us), broadcast, status etc.
}

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v])

export function normalizeEvolutionEvent(json: unknown): EvolutionEvent {
  const env = evoEnvelope.safeParse(json)
  if (!env.success) return { kind: 'ignored' }
  const { event, instance, data } = env.data
  const name = event.toLowerCase().replace(/_/g, '.')

  if (name === 'qrcode.updated') {
    const d = z
      .object({
        base64: str.optional(),
        qrcode: z.object({ base64: str.optional() }).passthrough().optional(),
      })
      .passthrough()
      .safeParse(data)
    const qr = d.success ? (d.data.qrcode?.base64 ?? d.data.base64) : undefined
    return qr ? { kind: 'qr', instance, qr } : { kind: 'ignored' }
  }

  if (name === 'connection.update') {
    const d = z.object({ state: str }).passthrough().safeParse(data)
    return d.success ? { kind: 'connection', instance, status: mapEvolutionConnection(d.data.state) } : { kind: 'ignored' }
  }

  if (name === 'messages.upsert') {
    const inbound: NormalizedInbound[] = []
    for (const raw of asArray(data)) {
      const m = evoMessage.safeParse(raw)
      if (!m.success || m.data.key.fromMe) continue
      const body = m.data.message?.conversation ?? m.data.message?.extendedTextMessage?.text
      if (!body) continue
      const from = jidToRef(m.data.key.remoteJid, m.data.key.remoteJidAlt ?? m.data.key.senderPn)
      if (!from) continue
      inbound.push({
        from,
        ...(m.data.pushName ? { nome: m.data.pushName } : {}),
        body,
        providerMessageId: m.data.key.id,
        timestamp: secondsToDate(m.data.messageTimestamp),
      })
    }
    return inbound.length ? { kind: 'messages', instance, inbound } : { kind: 'ignored' }
  }

  if (name === 'messages.update') {
    const updates: NormalizedStatus[] = []
    for (const raw of asArray(data)) {
      const d = z
        .object({ keyId: str.optional(), status: str.optional(), fromMe: z.boolean().optional(), key: z.object({ id: str }).passthrough().optional() })
        .passthrough()
        .safeParse(raw)
      if (!d.success) continue
      const id = d.data.keyId ?? d.data.key?.id
      const status = d.data.status ? mapEvolutionMessageStatus(d.data.status) : null
      if (id && status) updates.push({ providerMessageId: id, status })
    }
    return updates.length ? { kind: 'status', instance, updates } : { kind: 'ignored' }
  }

  return { kind: 'ignored' }
}

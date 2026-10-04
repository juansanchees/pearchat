import { z } from 'zod'
import type { ConnectionStatusKind, MessageStatusKind } from '@/lib/types'
import { onlyDigits, toE164 } from './phone'
import { MEDIA_LABEL as LABEL_BY_KIND, type MediaKind } from '@/server/media/mime'
import type { ContactRef } from './provider'

// Normalização dos webhooks (Meta e Evolution) em tipos comuns. Funções puras: sem I/O.

/** Metadados de uma mídia vista no webhook (o arquivo é baixado depois, em segundo plano). */
export type NormalizedMedia = {
  type: MediaKind
  mime?: string
  size?: number
  name?: string
  durationSec?: number
  caption?: string
  /** Só quando a Evolution foi configurada com base64 no webhook (não é o nosso caso por padrão). */
  inlineBase64?: string
  /** JID do chat (ajuda a Evolution a achar a mensagem ao baixar). */
  remoteJid?: string
}

export type NormalizedInbound = {
  from: ContactRef
  nome?: string
  body: string
  providerMessageId: string
  timestamp: Date
  media?: NormalizedMedia
}
/** Mensagem enviada pelo próprio dono, direto no app do WhatsApp (celular), vista pelo webhook como `fromMe`. */
export type NormalizedOutbound = {
  /** Contato com quem o dono conversa (o chat). */
  to: ContactRef
  body: string
  providerMessageId: string
  timestamp: Date
  media?: NormalizedMedia
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
  | { kind: 'messages'; instance: string; inbound: NormalizedInbound[]; outbound: NormalizedOutbound[] }
  | { kind: 'status'; instance: string; updates: NormalizedStatus[] }
  | { kind: 'history'; instance: string; messages: HistoryMessage[] }
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
    const outbound: NormalizedOutbound[] = []
    for (const raw of asArray(data)) {
      const m = evoMessage.safeParse(raw)
      if (!m.success) continue
      if (m.data.key.fromMe) {
        // Resposta dada pelo celular: o PearChat grava e trata como atendimento manual (a rota decide a regra).
        const media = extractEvolutionMedia(m.data.message, m.data.key.remoteJid)
        const text = media ? (media.caption || LABEL_BY_KIND[media.type]) : extractEvolutionBody(m.data.message)
        const to = jidToRef(m.data.key.remoteJid, m.data.key.remoteJidAlt ?? m.data.key.senderPn)
        if (text && text.trim() && to) {
          outbound.push({ to, body: text, providerMessageId: m.data.key.id, timestamp: secondsToDate(m.data.messageTimestamp), ...(media ? { media } : {}) })
        }
        continue
      }
      const media = extractEvolutionMedia(m.data.message, m.data.key.remoteJid)
      const body = media ? (media.caption || LABEL_BY_KIND[media.type]) : (m.data.message?.conversation ?? m.data.message?.extendedTextMessage?.text)
      if (!body) continue
      const from = jidToRef(m.data.key.remoteJid, m.data.key.remoteJidAlt ?? m.data.key.senderPn)
      if (!from) continue
      inbound.push({
        from,
        ...(m.data.pushName ? { nome: m.data.pushName } : {}),
        body,
        providerMessageId: m.data.key.id,
        timestamp: secondsToDate(m.data.messageTimestamp),
        ...(media ? { media } : {}),
      })
    }
    return inbound.length || outbound.length ? { kind: 'messages', instance, inbound, outbound } : { kind: 'ignored' }
  }

  if (name === 'messages.set') {
    // Histórico enviado pelo WhatsApp logo após o pareamento (lotes grandes). Vai para o importador em lote.
    const list = Array.isArray(data) ? data : asArray(isObj(data) ? data.messages : undefined)
    const messages: HistoryMessage[] = []
    for (const raw of list) {
      const m = parseHistoryMessage(raw)
      if (m) messages.push(m)
    }
    return messages.length ? { kind: 'history', instance, messages } : { kind: 'ignored' }
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

// ---------------------------------------------------------------- Histórico (Evolution)

export type HistoryMessage = {
  /** JID do chat (remoteJid). */
  remoteJid: string
  from: ContactRef
  pushName?: string
  fromMe: boolean
  body: string
  providerMessageId: string
  timestamp: Date
  status: 'ENVIADA' | 'ENTREGUE' | 'LIDA'
  /** Só metadados: o histórico importado não baixa o arquivo (fica "expirada"). */
  media?: NormalizedMedia
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Só conversas individuais: ignora grupos, status/broadcast, canais (newsletter) e JIDs sem telefone. */
export function isIndividualJid(jid: string): boolean {
  const [user = '', host = ''] = jid.split('@')
  if (host === 'lid') return user.length > 0
  if (host === 's.whatsapp.net') return onlyDigits(user).length >= 8
  return false
}

const WRAPPERS = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'documentWithCaptionMessage', 'editedMessage']

const MEDIA_LABEL: [string, string][] = [
  ['imageMessage', '[Imagem]'],
  ['audioMessage', '[Áudio]'],
  ['videoMessage', '[Vídeo]'],
  ['ptvMessage', '[Vídeo]'],
  ['documentMessage', '[Documento]'],
  ['stickerMessage', '[Figurinha]'],
  ['locationMessage', '[Localização]'],
  ['liveLocationMessage', '[Localização]'],
  ['contactMessage', '[Contato]'],
  ['contactsArrayMessage', '[Contato]'],
]

const SKIP_KEYS = new Set([
  'messageContextInfo',
  'senderKeyDistributionMessage',
  'protocolMessage',
  'reactionMessage',
  'pollUpdateMessage',
  'keepInChatMessage',
  'encReactionMessage',
])

/** Texto da mensagem da Evolution/Baileys; mídia vira "[Imagem]" etc. null = não é conteúdo de conversa. */
export function extractEvolutionBody(message: unknown): string | null {
  let m: unknown = message
  for (let i = 0; i < 4 && isObj(m); i++) {
    const cur: Record<string, unknown> = m
    const key = WRAPPERS.find((k) => isObj(cur[k]))
    if (!key) break
    const inner = cur[key]
    m = isObj(inner) && isObj(inner.message) ? inner.message : inner
  }
  if (!isObj(m)) return null
  if (typeof m.conversation === 'string' && m.conversation) return m.conversation
  const ext = m.extendedTextMessage
  if (isObj(ext) && typeof ext.text === 'string' && ext.text) return ext.text
  for (const [key, label] of MEDIA_LABEL) {
    const media = m[key]
    if (isObj(media)) {
      const caption = typeof media.caption === 'string' ? media.caption.trim() : ''
      return caption ? `${label} ${caption}` : label
    }
  }
  if (Object.keys(m).every((k) => SKIP_KEYS.has(k))) return null
  return '[Mensagem não suportada]'
}

const MEDIA_FIELDS: [string, MediaKind][] = [
  ['imageMessage', 'image'],
  ['audioMessage', 'audio'],
  ['videoMessage', 'video'],
  ['ptvMessage', 'video'],
  ['documentMessage', 'document'],
  ['stickerMessage', 'sticker'],
]

function toInt(v: unknown): number | undefined {
  let n = NaN
  if (typeof v === 'number') n = v
  else if (typeof v === 'string') n = Number(v)
  else if (isObj(v) && typeof v.low === 'number') n = v.low
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined
}

function unwrapMessage(message: unknown): { inner: Record<string, unknown>; outer: Record<string, unknown> } | null {
  if (!isObj(message)) return null
  let m: Record<string, unknown> = message
  for (let i = 0; i < 4; i++) {
    const cur: Record<string, unknown> = m
    const key = WRAPPERS.find((k) => isObj(cur[k]))
    if (!key) break
    const inner = cur[key]
    m = isObj(inner) && isObj(inner.message) ? inner.message : isObj(inner) ? inner : m
    if (m === cur) break
  }
  return { inner: m, outer: message }
}

/** Descrição da mídia de uma mensagem da Evolution/Baileys (metadados, sem baixar nada). null = não é mídia. */
export function extractEvolutionMedia(message: unknown, remoteJid?: string): NormalizedMedia | null {
  const u = unwrapMessage(message)
  if (!u) return null
  for (const [field, type] of MEDIA_FIELDS) {
    const media = u.inner[field]
    if (!isObj(media)) continue
    const caption = typeof media.caption === 'string' ? media.caption.trim() : ''
    const name = typeof media.fileName === 'string' && media.fileName ? media.fileName : typeof media.title === 'string' && media.title ? media.title : undefined
    const b64 = [u.outer.base64, u.inner.base64, media.base64].find((v): v is string => typeof v === 'string' && v.length > 0)
    const size = toInt(media.fileLength)
    const durationSec = toInt(media.seconds)
    return {
      type,
      ...(typeof media.mimetype === 'string' && media.mimetype ? { mime: media.mimetype } : {}),
      ...(size !== undefined ? { size } : {}),
      ...(name ? { name } : {}),
      ...(durationSec !== undefined ? { durationSec } : {}),
      ...(caption ? { caption } : {}),
      ...(b64 ? { inlineBase64: b64 } : {}),
      ...(remoteJid ? { remoteJid } : {}),
    }
  }
  return null
}

/** messageTimestamp (segundos, string, Long {low} ou ms) -> Date; null se inválido. */
export function historyTimestamp(v: unknown): Date | null {
  let n = NaN
  if (typeof v === 'number') n = v
  else if (typeof v === 'string') n = Number(v)
  else if (isObj(v) && typeof v.low === 'number') n = v.low
  if (!Number.isFinite(n) || n <= 0) return null
  if (n > 1e12) n = n / 1000
  return new Date(n * 1000)
}

/** Maior status entre os registros de MessageUpdate (ou `status` direto); recebidas ficam "entregue". */
function historyStatus(raw: Record<string, unknown>, fromMe: boolean): HistoryMessage['status'] {
  if (!fromMe) return 'ENTREGUE'
  const found: string[] = []
  if (Array.isArray(raw.MessageUpdate)) {
    for (const u of raw.MessageUpdate) if (isObj(u) && typeof u.status === 'string') found.push(u.status)
  }
  if (typeof raw.status === 'string') found.push(raw.status)
  let best: HistoryMessage['status'] = 'ENVIADA'
  for (const s of found) {
    const mapped = mapEvolutionMessageStatus(s)
    if (mapped === 'lida') best = 'LIDA'
    else if (mapped === 'entregue' && best === 'ENVIADA') best = 'ENTREGUE'
  }
  return best
}

/** Mensagem crua da Evolution (findMessages / MESSAGES_SET / lastMessage de findChats) -> HistoryMessage. */
export function parseHistoryMessage(raw: unknown): HistoryMessage | null {
  if (!isObj(raw) || !isObj(raw.key)) return null
  const key = raw.key
  const remoteJid = typeof key.remoteJid === 'string' ? key.remoteJid : ''
  const id = typeof key.id === 'string' ? key.id : ''
  if (!remoteJid || !id || !isIndividualJid(remoteJid)) return null
  const timestamp = historyTimestamp(raw.messageTimestamp)
  if (!timestamp) return null
  const media = extractEvolutionMedia(raw.message, remoteJid)
  const body = media ? media.caption || LABEL_BY_KIND[media.type] : extractEvolutionBody(raw.message)
  if (body === null || !body.trim()) return null
  const fromMe = key.fromMe === true
  const alt =
    (typeof key.remoteJidAlt === 'string' ? key.remoteJidAlt : undefined) ??
    (typeof key.senderPn === 'string' ? key.senderPn : undefined)
  const from = jidToRef(remoteJid, alt)
  if (!from) return null
  const pushName = !fromMe && typeof raw.pushName === 'string' && raw.pushName.trim() ? raw.pushName.trim() : undefined
  return { remoteJid, from, ...(pushName ? { pushName } : {}), fromMe, body, providerMessageId: id, timestamp, status: historyStatus(raw, fromMe), ...(media ? { media: { ...media, inlineBase64: undefined } } : {}) }
}

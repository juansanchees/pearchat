import { z } from 'zod'
import type { ConnectionStatusKind, MessageStatusKind } from '@/lib/types'
import { onlyDigits, toE164 } from './phone'
import { MEDIA_LABEL as LABEL_BY_KIND, type MediaKind } from '@/server/media/mime'
import type { ContactRef } from './provider'
import { CALL_LABEL, EVENT_LABEL, GROUP_INVITE_LABEL, POLL_LABEL, UNSUPPORTED_LABEL } from './labels'

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
  /** Id da mídia na Graph API da Meta (baixa-se com GET /{id}). */
  providerMediaId?: string
}

export type NormalizedInbound = {
  from: ContactRef
  nome?: string
  body: string
  providerMessageId: string
  timestamp: Date
  media?: NormalizedMedia
  /** Tipo sem suporte (gravado como "[Mensagem não suportada]"): os campos do protocolo, só para o log (sem conteúdo). */
  unsupportedKeys?: string[]
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
export type NormalizedStatus = {
  providerMessageId: string
  status: DeliveryStatus
  errorCode?: number
  errorTitle?: string
  /** Evolution: chat da mensagem e se é nossa (ajuda a reconciliar envio sem confirmação, cujo id ainda não conhecemos). */
  remoteJid?: string
  fromMe?: boolean
}

const obj = z.object({}).passthrough()
const str = z.string()

function secondsToDate(v: unknown): Date {
  const n = typeof v === 'string' || typeof v === 'number' ? Number(v) : NaN
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : new Date()
}

// ---------------------------------------------------------------- Meta

export type MetaChange = { field: string; wabaId: string | null; value: Record<string, unknown> }

const metaEnvelope = z
  .object({
    entry: z.array(
      z
        .object({
          id: z.union([str, z.number()]).optional(),
          changes: z.array(z.object({ field: str.optional(), value: obj }).passthrough()).optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough()

/** Lista plana de mudanças de um webhook da Meta (campo, WABA da entrada e valor). Envelope inválido = lista vazia. */
export function parseMetaChanges(json: unknown): MetaChange[] {
  const env = metaEnvelope.safeParse(json)
  if (!env.success) return []
  const out: MetaChange[] = []
  for (const entry of env.data.entry) {
    for (const ch of entry.changes ?? []) {
      out.push({
        field: ch.field ?? '',
        wabaId: entry.id === undefined ? null : String(entry.id),
        value: ch.value as Record<string, unknown>,
      })
    }
  }
  return out
}

const metaContact = z
  .object({
    wa_id: str.optional(),
    user_id: str.optional(),
    profile: z.object({ name: str.optional(), username: str.optional() }).passthrough().optional(),
  })
  .passthrough()

const metaMetadata = z.object({ phone_number_id: z.union([str, z.number()]), display_phone_number: str.optional() }).passthrough()

const metaValue = z
  .object({
    metadata: metaMetadata,
    contacts: z.array(metaContact).optional(),
    messages: z.array(obj).optional(),
    statuses: z.array(obj).optional(),
    message_echoes: z.array(obj).optional(),
  })
  .passthrough()

export function mapMetaStatus(s: string): DeliveryStatus | null {
  switch (s) {
    case 'sent':
      return 'enviada'
    case 'delivered':
      return 'entregue'
    case 'read':
    case 'played':
      return 'lida'
    case 'failed':
      return 'falhou'
    default:
      return null
  }
}

export type MetaBatch = {
  phoneNumberId: string
  displayPhone?: string
  inbound: NormalizedInbound[]
  statuses: NormalizedStatus[]
  /** Mensagens que o dono enviou pelo app WhatsApp Business no celular (campo smb_message_echoes). */
  echoes: NormalizedOutbound[]
}

const asStr = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : typeof v === 'number' ? String(v) : undefined)
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const MEDIA_TYPES: Record<string, MediaKind> = { image: 'image', audio: 'audio', video: 'video', document: 'document', sticker: 'sticker' }

/** Corpo (texto/rótulo) e mídia de uma mensagem da Cloud API. `null` = não vira mensagem (ex.: reação). */
export function metaMessageContent(msg: Record<string, unknown>): { body: string; media?: NormalizedMedia } | null {
  const type = asStr(msg.type) ?? ''
  if (type === 'reaction' || type === 'system' || type === 'revoke' || type === 'edit') return null
  if (type === 'text') return { body: asStr(rec(msg.text).body) ?? '' }
  const mediaKind = MEDIA_TYPES[type]
  if (mediaKind) {
    const m = rec(msg[type])
    const caption = (asStr(m.caption) ?? '').trim()
    const id = asStr(m.id)
    const media: NormalizedMedia = {
      type: mediaKind,
      ...(asStr(m.mime_type) ? { mime: asStr(m.mime_type) } : {}),
      ...(asStr(m.filename) ? { name: asStr(m.filename) } : {}),
      ...(caption ? { caption } : {}),
      ...(id ? { providerMediaId: id } : {}),
    }
    const label = LABEL_BY_KIND[mediaKind]
    return { body: caption ? `${label} ${caption}` : label, media }
  }
  if (type === 'location') {
    const l = rec(msg.location)
    const where = [asStr(l.name), asStr(l.address)].filter(Boolean).join(', ')
    const lat = typeof l.latitude === 'number' ? l.latitude : Number(l.latitude)
    const lng = typeof l.longitude === 'number' ? l.longitude : Number(l.longitude)
    const link = Number.isFinite(lat) && Number.isFinite(lng) ? `https://maps.google.com/?q=${lat},${lng}` : ''
    return { body: ['[Localização]', where, link].filter(Boolean).join(' ') }
  }
  if (type === 'contacts') {
    const list = Array.isArray(msg.contacts) ? msg.contacts : []
    const names = list
      .map((c) => {
        const o = rec(c)
        const name = asStr(rec(o.name).formatted_name)
        const phone = asStr(rec(Array.isArray(o.phones) ? o.phones[0] : undefined).phone)
        return [name, phone ? `(${phone})` : ''].filter(Boolean).join(' ')
      })
      .filter(Boolean)
    return { body: names.length ? `[Contato] ${names.join('; ')}` : '[Contato]' }
  }
  if (type === 'interactive') {
    const i = rec(msg.interactive)
    const title = asStr(rec(i.button_reply).title) ?? asStr(rec(i.list_reply).title)
    return { body: title ?? '[Resposta interativa]' }
  }
  if (type === 'button') return { body: asStr(rec(msg.button).text) ?? '[Resposta de botão]' }
  if (type === 'order') return { body: '[Pedido]' }
  return { body: UNSUPPORTED_LABEL }
}

/** Payload do webhook da Meta (campos messages e smb_message_echoes) -> lotes por phone_number_id. Entradas inválidas são ignoradas. */
export function normalizeMetaPayload(json: unknown): MetaBatch[] {
  const batches: MetaBatch[] = []
  for (const change of parseMetaChanges(json)) {
    if (change.field !== 'messages' && change.field !== 'smb_message_echoes') continue
    const v = metaValue.safeParse(change.value)
    if (!v.success) continue
    const { metadata, contacts = [], messages = [], statuses = [], message_echoes = [] } = v.data
    const inbound: NormalizedInbound[] = []
    for (const msg of messages) {
      const id = asStr(msg.id)
      if (!id) continue
      const from = asStr(msg.from)
      const fromUserId = asStr(msg.from_user_id) ?? asStr(msg.user_id)
      // Contato correspondente: por wa_id (telefone) ou por user_id (BSUID).
      const contact =
        contacts.find((c) => (from && c.wa_id === from) || (fromUserId && c.user_id === fromUserId)) ?? (contacts.length === 1 ? contacts[0] : undefined)
      const waUserId = contact?.user_id ?? fromUserId
      const phoneRaw = contact?.wa_id ?? from
      const telefone = phoneRaw && onlyDigits(phoneRaw).length >= 8 ? toE164(phoneRaw) : undefined
      if (!telefone && !waUserId) continue
      const content = metaMessageContent(msg)
      if (!content) continue
      const nome = contact?.profile?.name ?? contact?.profile?.username
      inbound.push({
        from: { ...(waUserId ? { waUserId } : {}), ...(telefone ? { telefone } : {}) },
        ...(nome ? { nome } : {}),
        body: content.body,
        providerMessageId: id,
        timestamp: secondsToDate(msg.timestamp),
        ...(content.media ? { media: content.media } : {}),
      })
    }
    const st: NormalizedStatus[] = []
    for (const s of statuses) {
      const id = asStr(s.id)
      const status = mapMetaStatus(asStr(s.status) ?? '')
      if (!id || !status) continue
      const e0 = Array.isArray(s.errors) ? rec(s.errors[0]) : {}
      const code = typeof e0.code === 'number' ? e0.code : undefined
      const title = asStr(e0.title) ?? asStr(e0.message)
      st.push({ providerMessageId: id, status, ...(code !== undefined ? { errorCode: code } : {}), ...(title ? { errorTitle: title.slice(0, 200) } : {}) })
    }
    const echoes: NormalizedOutbound[] = []
    for (const e of message_echoes) {
      const id = asStr(e.id)
      const toRaw = asStr(e.to)
      if (!id || !toRaw) continue
      const content = metaMessageContent(e)
      if (!content) continue
      const telefone = onlyDigits(toRaw).length >= 8 ? toE164(toRaw) : undefined
      echoes.push({
        to: telefone ? { telefone } : { waUserId: toRaw },
        body: content.body,
        providerMessageId: id,
        timestamp: secondsToDate(e.timestamp),
        ...(content.media ? { media: content.media } : {}),
      })
    }
    if (inbound.length || st.length || echoes.length) {
      batches.push({
        phoneNumberId: String(metadata.phone_number_id),
        ...(metadata.display_phone_number ? { displayPhone: metadata.display_phone_number } : {}),
        inbound,
        statuses: st,
        echoes,
      })
    }
  }
  return batches
}

/**
 * Histórico da Coexistence (campo `history`): threads -> HistoryMessage (importador em lote). `declined` = o negócio recusou
 * compartilhar (erro 2593109). `progress` ajuda o diagnóstico.
 */
export function parseMetaHistory(value: unknown): { phoneNumberId: string | null; messages: HistoryMessage[]; declined: boolean; progress: number | null } {
  const v = rec(value)
  const phoneNumberId = asStr(rec(v.metadata).phone_number_id) ?? null
  const display = onlyDigits(asStr(rec(v.metadata).display_phone_number) ?? '')
  const messages: HistoryMessage[] = []
  let declined = false
  let progress: number | null = null
  for (const h of Array.isArray(v.history) ? v.history : []) {
    const hr = rec(h)
    if (Array.isArray(hr.errors) && hr.errors.some((e) => rec(e).code === 2593109)) declined = true
    const p = rec(hr.metadata).progress
    if (typeof p === 'number') progress = p
    for (const t of Array.isArray(hr.threads) ? hr.threads : []) {
      const tr = rec(t)
      const threadId = asStr(tr.id)
      if (!threadId) continue
      const digits = onlyDigits(threadId)
      const isPhone = digits.length >= 8 && digits === threadId.replace(/^\+/, '')
      for (const raw of Array.isArray(tr.messages) ? tr.messages : []) {
        const m = rec(raw)
        const id = asStr(m.id)
        const content = metaMessageContent(m)
        if (!id || !content) continue
        const from = onlyDigits(asStr(m.from) ?? '')
        const fromMe = from !== '' && (display ? from === display : from !== digits)
        const status = String(rec(m.history_context).status ?? '').toUpperCase()
        // Só metadados: o histórico importado nunca baixa o arquivo (sem id de mídia).
        const media: NormalizedMedia | undefined = content.media ? { ...content.media } : undefined
        if (media) delete media.providerMediaId
        messages.push({
          remoteJid: isPhone ? `${digits}@s.whatsapp.net` : `${threadId}@lid`,
          from: isPhone ? { telefone: toE164(digits) } : { waUserId: threadId },
          fromMe,
          body: content.body,
          providerMessageId: id,
          timestamp: secondsToDate(m.timestamp),
          status: status === 'READ' || status === 'PLAYED' ? 'LIDA' : status === 'DELIVERED' ? 'ENTREGUE' : 'ENVIADA',
          ...(media ? { media } : {}),
        })
      }
    }
  }
  return { phoneNumberId, messages, declined, progress }
}

// ---------------------------------------------------------------- Evolution

export type EvolutionEvent =
  | { kind: 'qr'; instance: string; qr: string }
  /** `reason` = statusReason da Evolution (código do Baileys: 401 = sessão encerrada no celular, 428/408/515 = queda passageira). */
  | { kind: 'connection'; instance: string; status: ConnectionStatusKind; reason?: number }
  | { kind: 'messages'; instance: string; inbound: NormalizedInbound[]; outbound: NormalizedOutbound[] }
  /** SEND_MESSAGE: eco de um envio feito PELA API (pelo PearChat). Nunca é "resposta pelo celular". */
  | { kind: 'sent'; instance: string; sent: NormalizedOutbound[] }
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

/** Parte do usuário de um JID, sem o sufixo de dispositivo ("5511999990000:12@s.whatsapp.net" -> "5511999990000"). */
const jidUser = (jid: string): string => (jid.split('@')[0] ?? '').split(':')[0] ?? ''

/**
 * JID da Evolution/Baileys -> contato. `@lid` vira `waUserId` (o LID), NUNCA telefone; o telefone real só entra quando a
 * Evolution o informa em `key.remoteJidAlt` (Baileys 7 / Evolution 2.3.x) ou `key.senderPn` (Baileys 6): `<tel>@s.whatsapp.net`.
 */
function jidToRef(jid: string, alt?: string): ContactRef | null {
  const host = jid.split('@')[1] ?? ''
  const user = jidUser(jid)
  if (host === 'lid') {
    const phoneJid = alt && alt.endsWith('@s.whatsapp.net') ? jidUser(alt) : undefined
    const telefone = phoneJid && onlyDigits(phoneJid).length >= 8 ? toE164(phoneJid) : undefined
    return { waUserId: user, ...(telefone ? { telefone } : {}) }
  }
  if (host === 's.whatsapp.net') {
    return onlyDigits(user).length >= 8 ? { telefone: toE164(user) } : null
  }
  return null // grupos (@g.us), broadcast, status etc.
}

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v])

/** JID da Evolution -> contato (mesma regra do webhook). null = grupo/broadcast/inválido. */
export const contactRefFromJid = (jid: string, alt?: string): ContactRef | null => jidToRef(jid, alt)

/** Mensagem nossa (fromMe do celular ou eco SEND_MESSAGE da API) -> NormalizedOutbound. null = sem conteúdo/destino. */
function ownMessageOf(d: z.infer<typeof evoMessage>): NormalizedOutbound | null {
  const media = extractEvolutionMedia(d.message, d.key.remoteJid)
  const text = media ? media.caption || LABEL_BY_KIND[media.type] : extractEvolutionBody(d.message)
  const to = jidToRef(d.key.remoteJid, d.key.remoteJidAlt ?? d.key.senderPn)
  if (!text || !text.trim() || !to) return null
  return { to, body: text, providerMessageId: d.key.id, timestamp: secondsToDate(d.messageTimestamp), ...(media ? { media } : {}) }
}

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
    const d = z.object({ state: str, statusReason: z.union([z.number(), str]).optional() }).passthrough().safeParse(data)
    if (!d.success) return { kind: 'ignored' }
    const reason = Number(d.data.statusReason)
    return { kind: 'connection', instance, status: mapEvolutionConnection(d.data.state), ...(Number.isFinite(reason) && reason > 0 ? { reason } : {}) }
  }

  if (name === 'messages.upsert') {
    const inbound: NormalizedInbound[] = []
    const outbound: NormalizedOutbound[] = []
    for (const raw of asArray(data)) {
      const m = evoMessage.safeParse(raw)
      if (!m.success) continue
      if (m.data.key.fromMe) {
        // Resposta dada pelo celular: o PearChat grava e trata como atendimento manual (a rota decide a regra).
        const o = ownMessageOf(m.data)
        if (o) outbound.push(o)
        continue
      }
      const media = extractEvolutionMedia(m.data.message, m.data.key.remoteJid)
      // Mesmo extrator do histórico: localização, contato, resposta de botão/lista, enquete, chamada... viram texto/rótulo
      // legível em vez de sumirem. null = não é conteúdo de conversa (reação, protocolo, voto de enquete).
      const body = media ? (media.caption || LABEL_BY_KIND[media.type]) : extractEvolutionBody(m.data.message)
      if (!body || !body.trim()) continue
      const from = jidToRef(m.data.key.remoteJid, m.data.key.remoteJidAlt ?? m.data.key.senderPn)
      if (!from) continue
      const unsupportedKeys = body === UNSUPPORTED_LABEL ? Object.keys(unwrapMessage(m.data.message)?.inner ?? {}).slice(0, 8) : undefined
      inbound.push({
        from,
        ...(m.data.pushName ? { nome: m.data.pushName } : {}),
        body,
        providerMessageId: m.data.key.id,
        timestamp: secondsToDate(m.data.messageTimestamp),
        ...(media ? { media } : {}),
        ...(unsupportedKeys ? { unsupportedKeys } : {}),
      })
    }
    return inbound.length || outbound.length ? { kind: 'messages', instance, inbound, outbound } : { kind: 'ignored' }
  }

  if (name === 'send.message') {
    // Eco do envio feito pela API (o próprio PearChat): carrega o id do provedor para reconciliar envio sem confirmação.
    const sent: NormalizedOutbound[] = []
    for (const raw of asArray(data)) {
      const m = evoMessage.safeParse(raw)
      if (!m.success) continue
      const o = ownMessageOf(m.data)
      if (o) sent.push(o)
    }
    return sent.length ? { kind: 'sent', instance, sent } : { kind: 'ignored' }
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
        .object({
          keyId: str.optional(),
          status: str.optional(),
          fromMe: z.boolean().optional(),
          remoteJid: str.optional(),
          key: z.object({ id: str, remoteJid: str.optional(), fromMe: z.boolean().optional() }).passthrough().optional(),
        })
        .passthrough()
        .safeParse(raw)
      if (!d.success) continue
      const id = d.data.keyId ?? d.data.key?.id
      const status = d.data.status ? mapEvolutionMessageStatus(d.data.status) : null
      const remoteJid = d.data.remoteJid ?? d.data.key?.remoteJid
      const fromMe = d.data.fromMe ?? d.data.key?.fromMe
      if (id && status) updates.push({ providerMessageId: id, status, ...(remoteJid ? { remoteJid } : {}), ...(fromMe !== undefined ? { fromMe } : {}) })
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

const WRAPPERS = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'documentWithCaptionMessage', 'editedMessage', 'deviceSentMessage']

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
  ['lottieStickerMessage', '[Figurinha]'],
  ['orderMessage', '[Pedido]'],
  ['productMessage', '[Produto]'],
  ['callLogMesssage', CALL_LABEL], // (sic) o campo do protocolo tem três "s"
  ['call', CALL_LABEL],
  ['groupInviteMessage', GROUP_INVITE_LABEL],
  ['eventMessage', EVENT_LABEL],
]

/** Respostas a botão/lista: o texto que o cliente escolheu. */
const REPLY_FIELDS: [string, string][] = [
  ['buttonsResponseMessage', 'selectedDisplayText'],
  ['listResponseMessage', 'title'],
  ['templateButtonReplyMessage', 'selectedDisplayText'],
]
/** Criação de enquete. Os votos (pollUpdateMessage) continuam ignorados. */
const POLL_FIELDS = ['pollCreationMessage', 'pollCreationMessageV2', 'pollCreationMessageV3']

const SKIP_KEYS = new Set([
  'messageContextInfo',
  'senderKeyDistributionMessage',
  'protocolMessage',
  'reactionMessage',
  'pollUpdateMessage',
  'keepInChatMessage',
  'encReactionMessage',
  'albumMessage', // cabeçalho do álbum: as fotos chegam como mensagens de imagem à parte
])

const trimStr = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** locationMessage/liveLocationMessage -> "[Localização] Nome, endereço https://maps.google.com/?q=lat,lng". */
function locationText(l: Record<string, unknown>): string {
  const where = [trimStr(l.name), trimStr(l.address), trimStr(l.caption)].filter(Boolean).join(', ')
  const lat = Number(l.degreesLatitude)
  const lng = Number(l.degreesLongitude)
  const link = Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0) ? `https://maps.google.com/?q=${lat},${lng}` : ''
  return ['[Localização]', where, link].filter(Boolean).join(' ')
}

/** Telefone de um vCard: "waid=5511..." (WhatsApp) ou a linha TEL. */
function vcardPhone(vcard: string): string {
  const waid = /waid=(\d{8,15})/i.exec(vcard)?.[1]
  if (waid) return `+${waid}`
  const tel = /^TEL[^:\r\n]*:([+\d][\d\s().-]{6,})$/im.exec(vcard)?.[1]
  return tel ? tel.trim() : ''
}

/** contactMessage(s) -> "[Contato] Ana (+5511...); Beto (+5521...)". */
function contactsText(list: unknown[]): string {
  const items = list
    .slice(0, 10)
    .map((c) => {
      if (!isObj(c)) return ''
      const vcard = typeof c.vcard === 'string' ? c.vcard : ''
      const name = trimStr(c.displayName) || (/^FN:(.+)$/im.exec(vcard)?.[1]?.trim() ?? '')
      const phone = vcard ? vcardPhone(vcard) : ''
      return [name, phone ? `(${phone})` : ''].filter(Boolean).join(' ')
    })
    .filter(Boolean)
  return items.length ? `[Contato] ${items.join('; ')}` : '[Contato]'
}

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
  // Localização e cartão de contato: o essencial em texto (endereço/link do mapa; nome e telefone), como na API oficial.
  const loc = isObj(m.locationMessage) ? m.locationMessage : isObj(m.liveLocationMessage) ? m.liveLocationMessage : null
  if (loc) return locationText(loc)
  if (isObj(m.contactMessage)) return contactsText([m.contactMessage])
  if (isObj(m.contactsArrayMessage)) return contactsText(Array.isArray(m.contactsArrayMessage.contacts) ? m.contactsArrayMessage.contacts : [])
  for (const [key, label] of MEDIA_LABEL) {
    const media = m[key]
    if (isObj(media)) {
      const caption = typeof media.caption === 'string' ? media.caption.trim() : ''
      return caption ? `${label} ${caption}` : label
    }
  }
  for (const [key, field] of REPLY_FIELDS) {
    const r = m[key]
    if (!isObj(r)) continue
    const text = typeof r[field] === 'string' ? (r[field] as string).trim() : ''
    return text || '[Resposta interativa]'
  }
  if (isObj(m.interactiveResponseMessage)) return '[Resposta interativa]'
  for (const key of POLL_FIELDS) {
    const poll = m[key]
    if (isObj(poll)) return typeof poll.name === 'string' && poll.name.trim() ? `${POLL_LABEL} ${poll.name.trim()}` : POLL_LABEL
  }
  if (Object.keys(m).every((k) => SKIP_KEYS.has(k))) return null
  return UNSUPPORTED_LABEL
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

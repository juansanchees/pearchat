import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import { findOrCreateContact } from '@/server/messages/ingest'
import { EvolutionProvider } from './evolution'
import { sanitizeFileName } from '@/server/media/mime'
import { isIndividualJid, parseHistoryMessage } from './normalize'
import type { HistoryMessage } from './normalize'
import { onlyDigits } from './phone'
import type { ContactRef } from './provider'

// Importação do histórico do WhatsApp (conexão rápida / Evolution). Traz as conversas e mensagens que já
// existiam quando o número foi conectado. NÃO passa pelo ingestInboundMessage: histórico nunca dispara
// automações (IA, follow-up, campanhas), não conta uso e não emite um evento por mensagem.
// Logs: só contagens e ids (nunca texto de mensagem nem telefone).

export type ImportOptions = {
  /** Conversas mais recentes a importar (padrão 200). */
  maxChats?: number
  /** Mensagens por conversa (padrão 50). */
  messagesPerChat?: number
  /** Não importa mensagens mais antigas que isto (padrão 90 dias). */
  maxAgeDays?: number
  /** Pausa entre conversas, para não pressionar o pool do banco (padrão 80 ms). */
  pauseMs?: number
}

export type HistoryStats = {
  chats: number
  conversas: number
  contatos: number
  mensagens: number
  ignoradas: number
  falhas: number
  duracaoMs: number
  finalizadaEm: string
  erro?: string
}

export type ImportState = 'ok' | 'busy' | 'unsupported' | 'desconectado' | 'erro'
export type ImportResult = { state: ImportState; stats?: HistoryStats }

const DEFAULTS = { maxChats: 200, messagesPerChat: 50, maxAgeDays: 90, pauseMs: 80 }
const MESSAGE_PAGE = 50
const CHAT_PAGE = 100
const MAX_CHAT_SCAN = 2_000
const STALE_MS = 15 * 60_000
/** Passagens incrementais depois de conectar (minutos): o histórico do Baileys chega aos poucos. */
export const HISTORY_MILESTONES_MIN = [1, 3, 10, 30]

const isMock = () => process.env.WA_MOCK === 'true'
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const logH = (msg: string) => console.log(`[wa/history] ${msg}`)
const shortErr = (e: unknown) => (e instanceof Error ? e.message : 'erro').slice(0, 200)

// ---------------------------------------------------------------- Respostas da Evolution (tolerantes)

const chatSchema = z
  .object({
    remoteJid: z.string(),
    pushName: z.string().nullish(),
    unreadCount: z.number().nullish(),
    lastMessage: z.unknown().optional(),
  })
  .passthrough()

const contactSchema = z.object({ remoteJid: z.string(), pushName: z.string().nullish() }).passthrough()

function asList(raw: unknown, ...keys: string[]): unknown[] {
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object') {
    for (const k of keys) {
      const v = (raw as Record<string, unknown>)[k]
      if (Array.isArray(v)) return v
      if (v && typeof v === 'object') {
        const inner = (v as Record<string, unknown>).records
        if (Array.isArray(inner)) return inner
      }
    }
  }
  return []
}

function pagesOf(raw: unknown): number | undefined {
  const m = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).messages : undefined
  const p = m && typeof m === 'object' ? (m as Record<string, unknown>).pages : undefined
  return typeof p === 'number' ? p : undefined
}

type ChatInfo = { remoteJid: string; pushName?: string; unread?: number; last?: HistoryMessage }

// ---------------------------------------------------------------- Gravação em lote

export type ChatBatch = {
  from: ContactRef
  nome?: string
  unread?: number
  messages: HistoryMessage[]
}

/** Grava um chat: contato, conversa e mensagens (createMany + skipDuplicates). Idempotente. */
export async function persistChat(workspaceId: string, b: ChatBatch): Promise<{ conversaCriada: boolean; inseridas: number }> {
  if (!b.from.telefone && !b.from.waUserId) return { conversaCriada: false, inseridas: 0 }
  const contact = await findOrCreateContact(workspaceId, b.from, b.nome)
  const existing = await db.conversation.findUnique({
    where: { contactId: contact.id },
    select: { id: true, lastMessageAt: true },
  })
  const conv = existing
    ? existing
    : await db.conversation.upsert({
        where: { contactId: contact.id },
        create: { workspaceId, contactId: contact.id, unread: b.unread && b.unread > 0 ? b.unread : 0 },
        update: {},
        select: { id: true, lastMessageAt: true },
      })

  let inseridas = 0
  if (b.messages.length) {
    const r = await db.message.createMany({
      data: b.messages.map((m) => ({
        conversationId: conv.id,
        direction: m.fromMe ? ('OUT' as const) : ('IN' as const),
        author: m.fromMe ? ('USER' as const) : ('CLIENTE' as const),
        body: m.body,
        status: m.status,
        providerMessageId: m.providerMessageId,
        imported: true,
        createdAt: m.timestamp,
        // Histórico: só metadados da mídia; o arquivo não é baixado ("Mídia não disponível" na bolha).
        ...(m.media
          ? {
              mediaType: m.media.type,
              mediaMime: m.media.mime ?? null,
              mediaSize: m.media.size !== undefined && m.media.size <= 2_147_483_647 ? m.media.size : null,
              mediaName: m.media.name ? sanitizeFileName(m.media.name) : null,
              mediaDurationSec: m.media.durationSec !== undefined && m.media.durationSec <= 2_147_483_647 ? m.media.durationSec : null,
              mediaStatus: 'expirada',
            }
          : {}),
      })),
      skipDuplicates: true,
    })
    inseridas = r.count
  }

  const patch: Prisma.ConversationUpdateInput = {}
  const lastAt = b.messages.reduce<Date | null>((acc, m) => (!acc || m.timestamp > acc ? m.timestamp : acc), null)
  if (lastAt && (!conv.lastMessageAt || lastAt > conv.lastMessageAt)) patch.lastMessageAt = lastAt
  if (existing && b.unread !== undefined) {
    // Conversa que só tem histórico: acompanha o contador de não lidas do WhatsApp.
    const live = await db.message.count({ where: { conversationId: conv.id, imported: false } })
    if (live === 0) patch.unread = Math.max(0, b.unread)
  }
  if (Object.keys(patch).length) await db.conversation.update({ where: { id: conv.id }, data: patch })
  return { conversaCriada: !existing, inseridas }
}

// ---------------------------------------------------------------- Importação

type Cfg = typeof DEFAULTS

function ownDigitsOf(numero: string | null): string {
  return numero ? onlyDigits(numero) : ''
}

async function listChats(provider: EvolutionProvider, workspaceId: string, cfg: Cfg, cutoff: Date, own: string) {
  const out: ChatInfo[] = []
  const seen = new Set<string>()
  let ignoradas = 0
  for (let skip = 0; skip < MAX_CHAT_SCAN && out.length < cfg.maxChats; skip += CHAT_PAGE) {
    const raw = await provider.findChats(workspaceId, CHAT_PAGE, skip)
    const list = asList(raw, 'chats', 'data')
    if (list.length === 0) break
    let fresh = 0
    for (const item of list) {
      const c = chatSchema.safeParse(item)
      if (!c.success || seen.has(c.data.remoteJid)) continue
      seen.add(c.data.remoteJid)
      fresh++
      const jid = c.data.remoteJid
      if (!isIndividualJid(jid)) {
        ignoradas++
        continue
      }
      if (own && jid.endsWith('@s.whatsapp.net') && onlyDigits(jid.split('@')[0] ?? '') === own) {
        ignoradas++
        continue
      }
      const last = c.data.lastMessage ? parseHistoryMessage(c.data.lastMessage) : null
      if (last && last.timestamp < cutoff) {
        ignoradas++
        continue
      }
      out.push({
        remoteJid: jid,
        ...(c.data.pushName ? { pushName: c.data.pushName } : {}),
        ...(typeof c.data.unreadCount === 'number' ? { unread: c.data.unreadCount } : {}),
        ...(last ? { last } : {}),
      })
      if (out.length >= cfg.maxChats) break
    }
    // Servidor que ignora take/skip repete a mesma lista: para.
    if (fresh === 0 || list.length < CHAT_PAGE) break
  }
  return { chats: out, ignoradas }
}

async function fetchChatMessages(provider: EvolutionProvider, workspaceId: string, chat: ChatInfo, cfg: Cfg, cutoff: Date) {
  const byId = new Map<string, HistoryMessage>()
  if (chat.last) byId.set(chat.last.providerMessageId, chat.last)
  for (let page = 1; page <= 20; page++) {
    const raw = await provider.findMessages(workspaceId, chat.remoteJid, page, MESSAGE_PAGE)
    const records = asList(raw, 'messages')
    if (records.length === 0) break
    let reachedOld = false
    for (const r of records) {
      const m = parseHistoryMessage(r)
      if (!m) continue
      if (m.timestamp < cutoff) {
        reachedOld = true
        continue
      }
      byId.set(m.providerMessageId, m)
    }
    const pages = pagesOf(raw)
    if (reachedOld || byId.size >= cfg.messagesPerChat || records.length < MESSAGE_PAGE || (pages !== undefined && page >= pages)) break
  }
  return Array.from(byId.values()).sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()).slice(0, cfg.messagesPerChat)
}

async function contactNames(provider: EvolutionProvider, workspaceId: string): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  try {
    for (const item of asList(await provider.findContacts(workspaceId), 'contacts', 'data')) {
      const c = contactSchema.safeParse(item)
      if (c.success && c.data.pushName && map.size < 20_000) map.set(c.data.remoteJid, c.data.pushName)
    }
  } catch {
    // nomes são um extra: segue sem eles
  }
  return map
}

async function doImport(workspaceId: string, numero: string | null, cfg: Cfg): Promise<HistoryStats> {
  const started = Date.now()
  const provider = new EvolutionProvider()
  const cutoff = new Date(Date.now() - cfg.maxAgeDays * 86_400_000)
  const own = ownDigitsOf(numero)
  const contactsBefore = await db.contact.count({ where: { workspaceId } })

  const { chats, ignoradas } = await listChats(provider, workspaceId, cfg, cutoff, own)
  const names = chats.length ? await contactNames(provider, workspaceId) : new Map<string, string>()

  let conversas = 0
  let mensagens = 0
  let falhas = 0
  let consecutivas = 0
  let done = 0
  for (const chat of chats) {
    try {
      const msgs = await fetchChatMessages(provider, workspaceId, chat, cfg, cutoff)
      if (msgs.length) {
        const first = msgs.find((m) => !m.fromMe) ?? msgs[0]
        const nome = chat.pushName ?? names.get(chat.remoteJid) ?? msgs.find((m) => m.pushName)?.pushName
        const r = await persistChat(workspaceId, {
          from: first.from,
          ...(nome ? { nome } : {}),
          ...(chat.unread !== undefined ? { unread: chat.unread } : {}),
          messages: msgs,
        })
        if (r.conversaCriada) conversas++
        mensagens += r.inseridas
      }
      consecutivas = 0
    } catch (e) {
      falhas++
      consecutivas++
      logH(`falha em um chat do workspace ${workspaceId}: ${shortErr(e)}`)
      // Evolution fora do ar: não adianta insistir nos demais.
      if (consecutivas >= 5) throw new Error('Evolution API indisponível durante a importação')
    }
    done++
    if (done % 25 === 0) {
      await db.whatsAppSession
        .update({ where: { workspaceId }, data: { historyStats: { progresso: done, total: chats.length } } })
        .catch(() => {})
    }
    await sleep(cfg.pauseMs)
  }

  const contactsAfter = await db.contact.count({ where: { workspaceId } })
  return {
    chats: chats.length,
    conversas,
    contatos: Math.max(0, contactsAfter - contactsBefore),
    mensagens,
    ignoradas,
    falhas,
    duracaoMs: Date.now() - started,
    finalizadaEm: new Date().toISOString(),
  }
}

async function claim(workspaceId: string): Promise<{ state: ImportState; numero: string | null }> {
  const s = await db.whatsAppSession.findUnique({ where: { workspaceId } })
  if (!s || s.provider !== 'RAPIDA' || isMock()) return { state: 'unsupported', numero: null }
  if (s.status !== 'CONECTADO') return { state: 'desconectado', numero: s.numero }
  const r = await db.whatsAppSession.updateMany({
    where: {
      workspaceId,
      OR: [{ historyStatus: { not: 'importando' } }, { historyStartedAt: null }, { historyStartedAt: { lt: new Date(Date.now() - STALE_MS) } }],
    },
    data: { historyStatus: 'importando', historyStartedAt: new Date() },
  })
  return { state: r.count === 1 ? 'ok' : 'busy', numero: s.numero }
}

async function runClaimed(workspaceId: string, numero: string | null, opts: ImportOptions): Promise<ImportResult> {
  const cfg: Cfg = { ...DEFAULTS, ...opts }
  try {
    await new EvolutionProvider().ensureHistoryConfig(workspaceId).catch(() => undefined)
    const stats = await doImport(workspaceId, numero, cfg)
    await db.whatsAppSession.update({
      where: { workspaceId },
      data: { historyStatus: 'concluida', historyImportedAt: new Date(), historyStats: stats as unknown as Prisma.InputJsonValue },
    })
    logH(`workspace ${workspaceId}: ${stats.chats} chats, ${stats.conversas} conversas novas, ${stats.mensagens} mensagens, ${stats.falhas} falhas`)
    return { state: 'ok', stats }
  } catch (e) {
    const erro = shortErr(e)
    logH(`workspace ${workspaceId}: erro (${erro})`)
    const stats = { chats: 0, conversas: 0, contatos: 0, mensagens: 0, ignoradas: 0, falhas: 0, duracaoMs: 0, finalizadaEm: new Date().toISOString(), erro }
    await db.whatsAppSession
      .update({ where: { workspaceId }, data: { historyStatus: 'erro', historyStats: stats as unknown as Prisma.InputJsonValue } })
      .catch(() => {})
    return { state: 'erro', stats }
  }
}

/** Importa e espera terminar. Nunca lança. Provedor oficial/mock: devolve 'unsupported'. */
export async function importHistory(workspaceId: string, opts: ImportOptions = {}): Promise<ImportResult> {
  try {
    const c = await claim(workspaceId)
    if (c.state !== 'ok') return { state: c.state }
    return await runClaimed(workspaceId, c.numero, opts)
  } catch (e) {
    logH(`workspace ${workspaceId}: falha ao iniciar (${shortErr(e)})`)
    return { state: 'erro' }
  }
}

/** Reivindica e roda em segundo plano; devolve o estado da reivindicação (para a rota responder 409). */
export async function startHistoryImport(workspaceId: string, opts: ImportOptions = {}): Promise<ImportState> {
  try {
    const c = await claim(workspaceId)
    if (c.state === 'ok') void runClaimed(workspaceId, c.numero, opts).catch(() => {})
    return c.state
  } catch (e) {
    logH(`workspace ${workspaceId}: falha ao iniciar (${shortErr(e)})`)
    return 'erro'
  }
}

/** Chamado quando a conexão passa a CONECTADO: primeira importação em segundo plano, depois o agendador refaz. */
export function scheduleInitialImport(workspaceId: string): void {
  const t = setTimeout(() => void startHistoryImport(workspaceId), 15_000)
  t.unref()
}

/** Agendador: refaz a importação aos 1, 3, 10 e 30 min depois de conectar e depois para. */
export async function runDueHistoryImports(): Promise<number> {
  if (isMock()) return 0
  const rows = await db.whatsAppSession.findMany({
    where: { provider: 'RAPIDA', status: 'CONECTADO', historyPasses: { lt: HISTORY_MILESTONES_MIN.length } },
    select: { workspaceId: true, connectedAt: true, historyPasses: true, historyStatus: true },
  })
  let started = 0
  for (const s of rows) {
    if (!s.connectedAt) {
      // Número que já estava conectado antes desta funcionalidade: marca agora e importa uma vez.
      const r = await db.whatsAppSession.updateMany({
        where: { workspaceId: s.workspaceId, connectedAt: null },
        data: { connectedAt: new Date() },
      })
      if (r.count === 1 && s.historyStatus === 'nao_iniciada') {
        await startHistoryImport(s.workspaceId)
        started++
      }
      continue
    }
    const minutes = HISTORY_MILESTONES_MIN[s.historyPasses] ?? 0
    if (Date.now() < s.connectedAt.getTime() + minutes * 60_000) continue
    const claimed = await db.whatsAppSession.updateMany({
      where: { workspaceId: s.workspaceId, historyPasses: s.historyPasses },
      data: { historyPasses: { increment: 1 } },
    })
    if (claimed.count !== 1) continue
    const res = await importHistory(s.workspaceId)
    if (res.state === 'ok') started++
  }
  return started
}

// ---------------------------------------------------------------- Webhook (MESSAGES_SET)

const gq = globalThis as unknown as { __pearchat_history_queue?: Promise<void> }

/** Histórico recebido pelo webhook: grava em lote, uma fila por processo (não estoura o pool do banco). */
export function queueHistoryMessages(workspaceId: string, messages: HistoryMessage[], opts: ImportOptions = {}): void {
  const cfg: Cfg = { ...DEFAULTS, ...opts }
  const prev = gq.__pearchat_history_queue ?? Promise.resolve()
  gq.__pearchat_history_queue = prev
    .then(async () => {
      const session = await db.whatsAppSession.findUnique({ where: { workspaceId }, select: { numero: true, provider: true } })
      // Histórico chega pelo webhook da Evolution (conexão rápida) ou da Coexistence da Meta (oficial).
      if (!session || !session.provider) return
      const own = ownDigitsOf(session.numero)
      const cutoff = new Date(Date.now() - cfg.maxAgeDays * 86_400_000)
      const groups = new Map<string, HistoryMessage[]>()
      for (const m of messages) {
        if (m.timestamp < cutoff) continue
        if (own && m.remoteJid.endsWith('@s.whatsapp.net') && onlyDigits(m.remoteJid.split('@')[0] ?? '') === own) continue
        const g = groups.get(m.remoteJid)
        if (g) g.push(m)
        else groups.set(m.remoteJid, [m])
      }
      const ordered = Array.from(groups.values())
        .map((g) => g.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()))
        .sort((a, b) => b[0].timestamp.getTime() - a[0].timestamp.getTime())
        .slice(0, cfg.maxChats)
      let inseridas = 0
      for (const g of ordered) {
        try {
          const msgs = g.slice(0, cfg.messagesPerChat)
          const first = msgs.find((m) => !m.fromMe) ?? msgs[0]
          const nome = msgs.find((m) => m.pushName)?.pushName
          const r = await persistChat(workspaceId, { from: first.from, ...(nome ? { nome } : {}), messages: msgs })
          inseridas += r.inseridas
        } catch (e) {
          logH(`lote do webhook: falha em um chat (${shortErr(e)})`)
        }
        await sleep(cfg.pauseMs)
      }
      logH(`workspace ${workspaceId}: lote do webhook com ${ordered.length} chats, ${inseridas} mensagens`)
    })
    .catch((e) => logH(`lote do webhook falhou (${shortErr(e)})`))
}

// ---------------------------------------------------------------- Status para a API/UI

export type HistoryDTO = {
  supported: boolean
  status: 'nao_iniciada' | 'importando' | 'concluida' | 'erro'
  importedAt: string | null
  stats: unknown
  /** Ainda dentro da janela das passagens automáticas (30 min depois de conectar). */
  sincronizando: boolean
}

export async function getHistoryDTO(workspaceId: string): Promise<HistoryDTO> {
  const s = await db.whatsAppSession.findUnique({ where: { workspaceId } })
  const supported = !!s && s.provider === 'RAPIDA' && !isMock()
  if (!s || !supported) return { supported: false, status: 'nao_iniciada', importedAt: null, stats: null, sincronizando: false }
  const stale = s.historyStatus === 'importando' && (!s.historyStartedAt || Date.now() - s.historyStartedAt.getTime() > STALE_MS)
  const status = (stale ? 'erro' : s.historyStatus) as HistoryDTO['status']
  const sincronizando =
    s.status === 'CONECTADO' &&
    !!s.connectedAt &&
    s.historyPasses < HISTORY_MILESTONES_MIN.length &&
    Date.now() - s.connectedAt.getTime() < 31 * 60_000
  return { supported, status, importedAt: s.historyImportedAt?.toISOString() ?? null, stats: s.historyStats, sincronizando }
}

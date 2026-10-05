import { Prisma } from '@prisma/client'
import type { Message } from '@prisma/client'
import { db } from '@/lib/db'
import { phoneCandidates } from '@/server/contacts/phone'
import { emitToWorkspace } from '@/server/realtime/emit'
import { EvolutionProvider } from '@/server/whatsapp/evolution'
import { isMock } from '@/server/whatsapp'
import { contactRefFromJid, parseHistoryMessage } from '@/server/whatsapp/normalize'
import type { NormalizedOutbound, NormalizedStatus } from '@/server/whatsapp/normalize'
import { lidDigits, onlyDigits } from '@/server/whatsapp/phone'
import type { ContactRef } from '@/server/whatsapp/provider'
import { forgetUnrecordedSend, takeUnrecordedSends } from './delivery-memory'
import { getConnected, log, logError } from './util'

// Reconciliação de envios sem confirmação (Message OUT PENDENTE com `uncertainSince`, ou PENDENTE antiga sem id porque o
// processo caiu no meio do envio). Regra: NUNCA reenviar às cegas. Evidências de entrega, em ordem:
//   1) eco SEND_MESSAGE da Evolution / eco `fromMe` com o mesmo texto (reconcileOwnEcho);
//   2) status (messages.update) de uma mensagem nossa naquele chat quando há UMA só incerta (correlateStatus);
//   3) consulta ativa ao banco da Evolution (findMessages fromMe do chat) com o mesmo texto depois do envio.
// Sem evidência depois do prazo: FALHOU com motivo ("não confirmado") e quem enviou (job da IA) pode reenviar UMA vez.

/** Prazo para confirmar um envio incerto antes de dá-lo como falho (o job da IA então pode reenviar). */
export const uncertainDeadlineMs = (): number => {
  const n = Number(process.env.DELIVERY_UNCERTAIN_MS)
  return Number.isFinite(n) && n > 0 ? n : 3 * 60_000
}
/** PENDENTE sem id e sem marca de incerteza há mais que isto = o processo caiu no meio do envio (envio normal leva < 90 s). */
const STUCK_PENDING_MS = 3 * 60_000
/** Janela de correlação entre o envio e o eco/status. */
const ECHO_WINDOW_MS = 15 * 60_000
/** Provedor fora do ar por mais que isto: desiste de confirmar e marca falha. */
const GIVE_UP_MS = 30 * 60_000

export const NOT_CONFIRMED_REASON = 'Envio não confirmado pelo WhatsApp'

const STATUS_MAP = { enviada: 'ENVIADA', entregue: 'ENTREGUE', lida: 'LIDA', falhou: 'FALHOU' } as const

function emitStatus(workspaceId: string, m: { id: string; conversationId: string }, status: 'enviada' | 'entregue' | 'lida' | 'falhou'): void {
  emitToWorkspace(workspaceId, 'message.status', { workspaceId, conversationId: m.conversationId, messageId: m.id, status })
}

/** Vincula o id do provedor a uma mensagem nossa sem id (envio confirmado). Devolve false se outra via já vinculou. */
export async function attachProviderId(
  workspaceId: string,
  msg: { id: string; conversationId: string },
  providerMessageId: string,
  status: 'enviada' | 'entregue' | 'lida' = 'enviada',
): Promise<boolean> {
  try {
    const r = await db.message.updateMany({
      where: { id: msg.id, providerMessageId: null },
      data: { providerMessageId, status: STATUS_MAP[status], uncertainSince: null, failReason: null },
    })
    if (r.count !== 1) return false
  } catch (e) {
    // O mesmo id já está noutra mensagem desta conversa (eco gravado antes): esta fica como enviada, sem id.
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e
    await db.message.updateMany({ where: { id: msg.id, providerMessageId: null }, data: { status: 'ENVIADA', uncertainSince: null, failReason: null } })
  }
  forgetUnrecordedSend(msg.id)
  emitStatus(workspaceId, msg, status)
  log('delivery', `envio confirmado (mensagem ${msg.id})`)
  return true
}

/** Conversa do contato (sem criar nada). */
async function conversationOf(workspaceId: string, ref: ContactRef): Promise<string | null> {
  const or: Prisma.ContactWhereInput[] = []
  if (ref.waUserId) or.push({ waUserId: ref.waUserId })
  if (ref.telefone) or.push({ telefone: { in: phoneCandidates(ref.telefone) } })
  if (or.length === 0) return null
  const c = await db.contact.findFirst({ where: { workspaceId, OR: or }, select: { conversation: { select: { id: true } } } })
  return c?.conversation?.id ?? null
}

/** Mensagens nossas ainda sem id que um eco/status pode confirmar: PENDENTE, ou FALHOU depois de ficar incerta. */
const unconfirmedOut = (conversationId: string, since: Date): Prisma.MessageWhereInput => ({
  conversationId,
  direction: 'OUT',
  providerMessageId: null,
  createdAt: { gte: since },
  OR: [{ status: 'PENDENTE' }, { status: 'FALHOU', uncertainSince: { not: null } }],
})

/**
 * Eco de um envio nosso (SEND_MESSAGE da Evolution, ou `fromMe` que é na verdade o nosso envio): se casa com uma
 * mensagem nossa sem id (mesmo texto, recente), vincula o id e devolve true. Nunca cria mensagem nem assume a conversa.
 */
export async function reconcileOwnEcho(workspaceId: string, echo: NormalizedOutbound): Promise<boolean> {
  const conversationId = await conversationOf(workspaceId, echo.to)
  if (!conversationId) return false
  const known = await db.message.findFirst({ where: { conversationId, providerMessageId: echo.providerMessageId }, select: { id: true } })
  if (known) return true
  const candidate = await db.message.findFirst({
    where: { ...unconfirmedOut(conversationId, new Date(Date.now() - ECHO_WINDOW_MS)), body: echo.body },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, conversationId: true },
  })
  if (!candidate) return false
  return attachProviderId(workspaceId, candidate, echo.providerMessageId)
}

/**
 * Status (messages.update) de uma mensagem nossa cujo id não conhecemos: se o chat tem UMA só mensagem incerta recente,
 * é ela (correlação). Com duas ou mais, não adivinha (a consulta ativa resolve).
 */
export async function correlateStatus(workspaceId: string, u: NormalizedStatus): Promise<boolean> {
  if (!u.fromMe || !u.remoteJid || u.status === 'falhou') return false
  const ref = contactRefFromJid(u.remoteJid)
  if (!ref) return false
  const conversationId = await conversationOf(workspaceId, ref)
  if (!conversationId) return false
  const list = await db.message.findMany({
    where: { ...unconfirmedOut(conversationId, new Date(Date.now() - ECHO_WINDOW_MS)), uncertainSince: { not: null } },
    select: { id: true, conversationId: true },
    take: 2,
  })
  if (list.length !== 1) return false
  return attachProviderId(workspaceId, list[0]!, u.providerMessageId, u.status)
}

/** JIDs em que a Evolution pode ter gravado o chat do contato (telefone e variantes do 9º dígito; LID). */
function jidsOf(c: { telefone: string | null; waUserId: string | null }): string[] {
  const out = new Set<string>()
  if (c.telefone) for (const p of phoneCandidates(c.telefone)) out.add(`${onlyDigits(p)}@s.whatsapp.net`)
  const lid = lidDigits(c.waUserId)
  if (lid) out.add(`${lid}@lid`)
  return Array.from(out).slice(0, 4)
}

function recordsOf(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object') {
    const m = (raw as Record<string, unknown>).messages
    if (Array.isArray(m)) return m
    if (m && typeof m === 'object' && Array.isArray((m as Record<string, unknown>).records)) return (m as { records: unknown[] }).records
  }
  return []
}

type Row = Message & { conversation: { workspaceId: string; contact: { telefone: string | null; waUserId: string | null } } }

/** Consulta ativa à Evolution: o envio está no banco dela? Devolve o id do provedor, null se não achou. Lança se a Evolution falhar. */
async function lookupEvolution(m: Row): Promise<string | null> {
  const p = new EvolutionProvider()
  const since = m.createdAt.getTime() - 60_000
  const used = new Set(
    (await db.message.findMany({ where: { conversationId: m.conversationId, providerMessageId: { not: null }, createdAt: { gte: new Date(since) } }, select: { providerMessageId: true } })).map(
      (x) => x.providerMessageId,
    ),
  )
  for (const jid of jidsOf(m.conversation.contact)) {
    const raw = await p.findRecentOwnMessages(m.conversation.workspaceId, jid, 20)
    for (const r of recordsOf(raw)) {
      const h = parseHistoryMessage(r)
      if (!h || !h.fromMe || used.has(h.providerMessageId)) continue
      if (h.timestamp.getTime() < since) continue
      if (h.body.trim() === m.body.trim()) return h.providerMessageId
    }
  }
  return null
}

/**
 * Tarefa do agendador: resolve envios incertos/presos. Devolve quantos resolveu (confirmados + dados como falhos).
 */
export async function reconcileUncertainSends(now = new Date()): Promise<number> {
  let resolved = 0
  // 1) Ids aceitos cuja gravação falhou (banco fora no instante do envio).
  for (const [messageId, providerMessageId] of takeUnrecordedSends()) {
    try {
      const m = await db.message.findUnique({ where: { id: messageId }, select: { id: true, conversationId: true, conversation: { select: { workspaceId: true } } } })
      if (!m) {
        forgetUnrecordedSend(messageId)
        continue
      }
      if (await attachProviderId(m.conversation.workspaceId, m, providerMessageId)) resolved++
      else forgetUnrecordedSend(messageId)
    } catch (e) {
      logError('delivery', 'aplicar id guardado em memória', e)
    }
  }

  // 2) PENDENTE incertas (ou presas sem id há mais de 3 min).
  const rows = (await db.message.findMany({
    where: {
      direction: 'OUT',
      status: 'PENDENTE',
      providerMessageId: null,
      OR: [{ uncertainSince: { not: null, lte: new Date(now.getTime() - 20_000) } }, { createdAt: { lt: new Date(now.getTime() - STUCK_PENDING_MS) } }],
    },
    orderBy: { createdAt: 'asc' },
    take: 30,
    include: { conversation: { select: { workspaceId: true, contact: { select: { telefone: true, waUserId: true } } } } },
  })) as Row[]
  for (const m of rows) {
    try {
      const workspaceId = m.conversation.workspaceId
      const since = (m.uncertainSince ?? m.createdAt).getTime()
      const age = now.getTime() - since
      const session = await getConnected(workspaceId)
      let lookupFailed = false
      if (session?.kind === 'rapida' && !isMock() && process.env.EVOLUTION_API_URL) {
        try {
          const id = await lookupEvolution(m)
          if (id && (await attachProviderId(workspaceId, m, id))) {
            resolved++
            continue
          }
        } catch (e) {
          lookupFailed = true
          logError('delivery', `consulta à Evolution falhou (mensagem ${m.id})`, e)
        }
      }
      const deadline = lookupFailed || !session ? GIVE_UP_MS : uncertainDeadlineMs()
      if (age < deadline) {
        if (!m.uncertainSince) await db.message.updateMany({ where: { id: m.id, uncertainSince: null }, data: { uncertainSince: now } })
        continue
      }
      // Sem evidência de entrega depois do prazo: falha com motivo (o job da IA pode reenviar uma vez).
      const r = await db.message.updateMany({
        where: { id: m.id, status: 'PENDENTE', providerMessageId: null },
        data: { status: 'FALHOU', failReason: NOT_CONFIRMED_REASON, uncertainSince: m.uncertainSince ?? now },
      })
      if (r.count === 1) {
        resolved++
        emitStatus(workspaceId, m, 'falhou')
        log('delivery', `envio não confirmado, marcado como falho (mensagem ${m.id})`)
      }
    } catch (e) {
      logError('delivery', `reconciliar mensagem ${m.id}`, e)
    }
  }
  return resolved
}

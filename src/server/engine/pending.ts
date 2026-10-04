import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { automationAllowed } from '@/server/billing/entitlements'
import { getAiQuota } from '@/server/settings/service'
import { NON_REPLYABLE_PREFIXES } from '@/server/whatsapp/labels'
import { AI_DEBOUNCE_MS, AI_JOB } from './ai-reply'
import { MANUAL_MARK } from './ai-job-notes'
import { getConnected, log } from './util'

// "Conversas esperando resposta": a ÚLTIMA mensagem é do cliente (inclusive importada do histórico) e ninguém respondeu
// depois (nem a IA, nem uma pessoa, nem o celular). Esta é a ÚNICA definição; a tela, o pedido de uma conversa, o
// "Devolver para a IA" e o lote usam as funções daqui. Escopo sempre pelo workspace recebido (o da sessão).

const HOUR = 3_600_000
export const JANELAS = { '24h': 24 * HOUR, '3d': 72 * HOUR, '7d': 168 * HOUR } as const
export type Janela = keyof typeof JANELAS
export const JANELA_PADRAO: Janela = '24h'
export const isJanela = (v: unknown): v is Janela => typeof v === 'string' && Object.prototype.hasOwnProperty.call(JANELAS, v)

/** Máximo de conversas enfileiradas por execução do lote. */
export const MAX_LOTE = 50
/** Espaço entre uma resposta e a próxima no lote (aleatório, crescente). */
export const LOTE_ESPACO_MIN_MS = 20_000
export const LOTE_ESPACO_MAX_MS = 60_000
/** "Devolver para a IA": só responde em seguida se o cliente escreveu há menos que isto. */
export const DEVOLVER_JANELA_MS = JANELAS['24h']

// Rótulos de evento de sistema (chamada, enquete...) não são o cliente falando: mesma lista de whatsapp/labels.ts.
const labelAlt = NON_REPLYABLE_PREFIXES.map((p) => p.slice(1, -1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
const NON_REPLYABLE_RE = `^\\s*\\[(${labelAlt})\\](\\s|$)`

/** Janela efetiva: na API oficial só texto livre dentro das 24 h do WhatsApp (depois, só modelos aprovados). */
const effectiveMs = (janela: Janela, official: boolean): number => (official ? JANELAS['24h'] : JANELAS[janela])

type PendingRow = { conversationId: string; messageId: string; lastAt: Date }

/** Fragmento comum: conversas do workspace cuja última mensagem (envios que falharam não contam) é do cliente. */
function pendingFrom(workspaceId: string, since: Date, conversationId?: string): Prisma.Sql {
  return Prisma.sql`
    FROM "Conversation" c
    JOIN "Contact" ct ON ct."id" = c."contactId"
    JOIN LATERAL (
      SELECT m."id", m."direction", m."body", m."mediaType", m."createdAt"
      FROM "Message" m
      WHERE m."conversationId" = c."id" AND NOT (m."direction" = 'OUT' AND m."status" = 'FALHOU')
      ORDER BY m."createdAt" DESC LIMIT 1
    ) lm ON true
    WHERE c."workspaceId" = ${workspaceId}
      ${conversationId ? Prisma.sql`AND c."id" = ${conversationId}` : Prisma.empty}
      AND c."lastMessageAt" >= ${new Date(since.getTime() - 24 * HOUR)}
      AND (c."mode" IS NULL OR c."mode" <> 'HUMANO')
      AND ct."optOut" = false
      AND COALESCE(ct."waUserId", '') NOT LIKE '%@g.us'
      AND lm."direction" = 'IN'
      AND lm."createdAt" >= ${since}
      AND (lm."mediaType" IS NOT NULL OR (btrim(lm."body") <> '' AND lm."body" !~ ${NON_REPLYABLE_RE}))
      AND NOT EXISTS (
        SELECT 1 FROM "AiJob" j WHERE j."conversationId" = c."id" AND j."status" IN (${AI_JOB.pendente}, ${AI_JOB.executando})
      )`
}

/** Conversas esperando resposta dentro da janela, as mais recentes primeiro. Uma consulta, sem N+1. */
export async function findPending(workspaceId: string, opts: { sinceMs: number; limit?: number; conversationId?: string; client?: Prisma.TransactionClient }): Promise<PendingRow[]> {
  const since = new Date(Date.now() - opts.sinceMs)
  const q = opts.client ?? db
  return q.$queryRaw<PendingRow[]>(
    Prisma.sql`SELECT c."id" AS "conversationId", lm."id" AS "messageId", lm."createdAt" AS "lastAt" ${pendingFrom(workspaceId, since, opts.conversationId)}
      ORDER BY lm."createdAt" DESC LIMIT ${opts.limit ?? 1000}`,
  )
}

/** Contagem por janela (24 h / 3 dias / 7 dias) numa consulta só. Na API oficial as três valem 24 h. */
export async function countPendingByWindow(workspaceId: string): Promise<Record<Janela, number>> {
  const session = await getConnected(workspaceId)
  const official = !!session?.official
  const now = Date.now()
  const since = new Date(now - effectiveMs('7d', official))
  const cut = (j: Janela) => new Date(now - effectiveMs(j, official))
  const [row] = await db.$queryRaw<{ d1: number; d3: number; d7: number }[]>(
    Prisma.sql`SELECT (count(*) FILTER (WHERE lm."createdAt" >= ${cut('24h')}))::int AS "d1",
        (count(*) FILTER (WHERE lm."createdAt" >= ${cut('3d')}))::int AS "d3",
        count(*)::int AS "d7" ${pendingFrom(workspaceId, since)}`,
  )
  return { '24h': row?.d1 ?? 0, '3d': row?.d3 ?? 0, '7d': row?.d7 ?? 0 }
}

/** Jobs de pedido ainda por rodar neste espaço ("Respondendo… faltam N"). */
export function countManualInFlight(workspaceId: string): Promise<number> {
  return db.aiJob.count({ where: { workspaceId, status: { in: [AI_JOB.pendente, AI_JOB.executando] }, error: { startsWith: MANUAL_MARK } } })
}

export type GateFail = 'IA_DESLIGADA' | 'WHATSAPP_DESCONECTADO' | 'ASSINATURA_INATIVA' | 'COTA_ESGOTADA'
type Gate = { ok: true; official: boolean; quotaLeft: number | null } | { ok: false; code: GateFail }

/** As mesmas travas da chegada de mensagem: IA ligada, WhatsApp conectado, assinatura ativa, cota de respostas do plano. */
async function checkGates(workspaceId: string): Promise<Gate> {
  const agent = await db.aiAgent.findUnique({ where: { workspaceId }, select: { enabled: true } })
  if (!agent?.enabled) return { ok: false, code: 'IA_DESLIGADA' }
  const session = await getConnected(workspaceId)
  if (!session) return { ok: false, code: 'WHATSAPP_DESCONECTADO' }
  if (!(await automationAllowed(workspaceId))) return { ok: false, code: 'ASSINATURA_INATIVA' }
  const quota = await getAiQuota(workspaceId)
  const quotaLeft = quota.limite === null ? null : Math.max(0, quota.limite - quota.usadas)
  if (quotaLeft === 0) return { ok: false, code: 'COTA_ESGOTADA' }
  return { ok: true, official: session.official, quotaLeft }
}

/** Trava de transação por chave (duas requisições iguais ao mesmo tempo viram uma só). */
async function lock(tx: Prisma.TransactionClient, key: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`
}

export type RequestOne =
  | { ok: true; jobId: string; jaEnfileirada: boolean }
  | { ok: false; code: GateFail | 'NADA_A_RESPONDER' | 'MODO_HUMANO' | 'NAO_ENCONTRADA' }

/**
 * Cria o AiJob que responde a última mensagem do cliente de UMA conversa (o mesmo job e a mesma execução da chegada de
 * mensagem: ai-reply.ts). Idempotente: se já há job pendente/em andamento, devolve `jaEnfileirada` sem criar outro.
 * `maxAgeMs`: só aceita se a última mensagem do cliente for mais recente que isso ("Devolver para a IA": 24 h).
 */
export async function requestAiReply(workspaceId: string, conversationId: string, opts: { maxAgeMs?: number } = {}): Promise<RequestOne> {
  const conv = await db.conversation.findFirst({ where: { id: conversationId, workspaceId }, select: { id: true, mode: true } })
  if (!conv) return { ok: false, code: 'NAO_ENCONTRADA' }
  const gate = await checkGates(workspaceId)
  if (!gate.ok) return { ok: false, code: gate.code }
  if (conv.mode === 'HUMANO') return { ok: false, code: 'MODO_HUMANO' }

  return db.$transaction(async (tx) => {
    await lock(tx, `ai-reply:${conversationId}`)
    const existing = await tx.aiJob.findFirst({
      where: { workspaceId, conversationId, status: { in: [AI_JOB.pendente, AI_JOB.executando] } },
      select: { id: true },
    })
    if (existing) return { ok: true as const, jobId: existing.id, jaEnfileirada: true }
    const maxAge = Math.min(opts.maxAgeMs ?? JANELAS['7d'], effectiveMs('7d', gate.official))
    const [row] = await findPending(workspaceId, { sinceMs: maxAge, limit: 1, conversationId, client: tx })
    if (!row) return { ok: false as const, code: 'NADA_A_RESPONDER' as const }
    const job = await tx.aiJob.create({
      data: { workspaceId, conversationId, status: AI_JOB.pendente, runAt: new Date(Date.now() + 1_500), error: MANUAL_MARK },
      select: { id: true },
    })
    return { ok: true as const, jobId: job.id, jaEnfileirada: false }
  })
}

/** A conversa está esperando resposta agora? (sem job em andamento). Para a ação "Responder com a IA" da tela. */
export async function conversationPendingState(workspaceId: string, conversationId: string): Promise<{ pendente: boolean; respondendo: boolean }> {
  const session = await getConnected(workspaceId)
  const [rows, job] = await Promise.all([
    findPending(workspaceId, { sinceMs: effectiveMs('7d', !!session?.official), limit: 1, conversationId }),
    db.aiJob.findFirst({ where: { workspaceId, conversationId, status: { in: [AI_JOB.pendente, AI_JOB.executando] } }, select: { id: true } }),
  ])
  return { pendente: rows.length > 0, respondendo: !!job }
}

export type RequestBatch =
  | { ok: true; enfileiradas: number; restantes: number; janela: Janela; espacamentoSeg: [number, number]; duracaoEstimadaSeg: number }
  | { ok: false; code: GateFail | 'LOTE_EM_ANDAMENTO'; faltam?: number }

/**
 * Enfileira as respostas das conversas paradas da janela (até MAX_LOTE, as mais recentes primeiro). Cada job recebe um
 * `runAt` crescente (20 a 60 s de atraso aleatório entre um e outro): o próprio AiJob.runAt espaça os envios, sem migration.
 * Não limita por horário de silêncio (que é dos disparos); respeita IA ligada, assinatura, cota, opt-out e modo humano
 * (a consulta e o job comum). Enquanto houver pedido anterior em andamento, recusa: nada é duplicado.
 */
export async function requestPendingBatch(workspaceId: string, janela: Janela = JANELA_PADRAO, rand: () => number = Math.random): Promise<RequestBatch> {
  const gate = await checkGates(workspaceId)
  if (!gate.ok) return { ok: false, code: gate.code }

  return db.$transaction(
    async (tx) => {
      await lock(tx, `ai-batch:${workspaceId}`)
      const emAndamento = await tx.aiJob.count({ where: { workspaceId, status: { in: [AI_JOB.pendente, AI_JOB.executando] }, error: { startsWith: MANUAL_MARK } } })
      if (emAndamento > 0) return { ok: false as const, code: 'LOTE_EM_ANDAMENTO' as const, faltam: emAndamento }

      const sinceMs = effectiveMs(janela, gate.official)
      const all = await findPending(workspaceId, { sinceMs, client: tx })
      // Teto fixo e, se o plano tem cota, nunca mais respostas do que ainda cabem nela.
      const cap = Math.min(MAX_LOTE, gate.quotaLeft ?? MAX_LOTE)
      const chosen = all.slice(0, cap)
      let at = Date.now() + AI_DEBOUNCE_MS
      const data = chosen.map((row, i) => {
        if (i > 0) at += LOTE_ESPACO_MIN_MS + Math.floor(rand() * (LOTE_ESPACO_MAX_MS - LOTE_ESPACO_MIN_MS + 1))
        return { workspaceId, conversationId: row.conversationId, status: AI_JOB.pendente, runAt: new Date(at), error: MANUAL_MARK }
      })
      if (data.length > 0) await tx.aiJob.createMany({ data })
      if (data.length > 0) log('ai', `workspace ${workspaceId}: lote de ${data.length} conversa(s) esperando resposta (janela ${janela})`)
      return {
        ok: true as const,
        enfileiradas: data.length,
        restantes: all.length - data.length,
        janela,
        espacamentoSeg: [LOTE_ESPACO_MIN_MS / 1000, LOTE_ESPACO_MAX_MS / 1000] as [number, number],
        duracaoEstimadaSeg: data.length > 0 ? Math.round((at - Date.now()) / 1000) : 0,
      }
    },
    { timeout: 30_000, maxWait: 10_000 },
  )
}

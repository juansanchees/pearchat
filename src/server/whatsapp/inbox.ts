import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { decrypt, encrypt } from './crypto'

// Caixa de entrada durável dos webhooks (tabela WebhookInbox). Regra: um evento de mensagem/status/conexão só é dado
// como recebido (2xx ao provedor) DEPOIS de gravado aqui. O processamento acontece a partir da caixa (na própria
// requisição, ou pelo agendador para o que ficou pendente: falha, queda do processo, deploy). Reentrega idêntica do
// provedor (mesmo corpo) cai na mesma linha: não duplica. O corpo fica cifrado e NUNCA vai para log.

export type InboxProvider = 'evolution' | 'meta'
export type InboxHandler = (json: unknown, ctx: { receivedAt: Date; inboxId: string }) => Promise<void>

/** Tentativas antes de desistir (a linha fica guardada com deadAt para diagnóstico/reprocesso manual). */
export const INBOX_MAX_ATTEMPTS = 8
/** Reserva de uma linha enquanto é processada; depois disso outra execução pode retomá-la (processo caiu no meio). */
const LOCK_MS = 2 * 60_000
/** Espera antes da próxima tentativa: 5 s, 10 s, 20 s... até 30 min. */
export const inboxBackoffMs = (attempt: number): number => Math.min(30 * 60_000, 5_000 * 2 ** Math.max(0, attempt - 1))
/** Processadas são apagadas depois disto; mortas ficam mais tempo (diagnóstico). */
const KEEP_PROCESSED_MS = 3 * 24 * 3_600_000
const KEEP_DEAD_MS = 30 * 24 * 3_600_000

const g = globalThis as unknown as { __pearchat_inbox_overrides?: Map<InboxProvider, InboxHandler> }
// Só para testes (simular falha no meio do processamento). Em globalThis: server.ts e bundles do Next são módulos distintos.
const overrides = (g.__pearchat_inbox_overrides ??= new Map<InboxProvider, InboxHandler>())

export function overrideInboxHandler(provider: InboxProvider, handler: InboxHandler | null): void {
  if (handler) overrides.set(provider, handler)
  else overrides.delete(provider)
}

/** Tratador de cada provedor (import tardio: evita ciclo de módulos e garante que existe em qualquer bundle). */
async function handlerFor(provider: string): Promise<InboxHandler> {
  const o = overrides.get(provider as InboxProvider)
  if (o) return o
  if (provider === 'evolution') return (await import('./evolution-webhook')).handleEvolutionPayload
  if (provider === 'meta') return (await import('./meta-webhook')).handleMetaPayload
  throw new Error(`sem tratador para ${provider}`)
}

/** Log estruturado (uma linha JSON), sem conteúdo de mensagem nem telefone. */
export function inboxLog(level: 'info' | 'warn' | 'error', event: string, fields: Record<string, string | number | boolean | null | undefined>): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, area: 'webhook-inbox', event, ...fields })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

const shortErr = (e: unknown): string => (e instanceof Error ? `${e.name}: ${e.message}` : 'erro desconhecido').slice(0, 300)

export const inboxDedupeKey = (raw: string): string => createHash('sha256').update(raw, 'utf8').digest('hex')

/**
 * Grava o corpo cru do webhook. Lança se o banco falhar (a rota responde 5xx e o provedor reentrega).
 * Reentrega idêntica devolve a linha existente (`duplicate`).
 */
export async function storeInbox(provider: InboxProvider, raw: string): Promise<{ id: string; duplicate: boolean; done: boolean }> {
  const dedupeKey = inboxDedupeKey(raw)
  try {
    const row = await db.webhookInbox.create({ data: { provider, dedupeKey, payload: encrypt(raw) }, select: { id: true } })
    return { id: row.id, duplicate: false, done: false }
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const ex = await db.webhookInbox.findUnique({
        where: { provider_dedupeKey: { provider, dedupeKey } },
        select: { id: true, processedAt: true, deadAt: true },
      })
      if (ex) return { id: ex.id, duplicate: true, done: !!ex.processedAt || !!ex.deadAt }
    }
    throw e
  }
}

export type InboxOutcome = 'processed' | 'retry' | 'dead' | 'busy' | 'missing'

/**
 * Reivindica e processa UMA linha. Nunca lança: falha vira nova tentativa com espera (ou "morta" no limite).
 * `busy` = outra execução está com ela (ou já foi processada).
 */
export async function processInboxRow(id: string): Promise<InboxOutcome> {
  const now = new Date()
  const claim = await db.webhookInbox.updateMany({
    where: { id, processedAt: null, deadAt: null, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
    data: { lockedUntil: new Date(now.getTime() + LOCK_MS), attempts: { increment: 1 } },
  })
  if (claim.count !== 1) return 'busy'
  const row = await db.webhookInbox.findUnique({ where: { id }, select: { provider: true, payload: true, receivedAt: true, attempts: true } })
  if (!row) return 'missing'
  try {
    const handler = await handlerFor(row.provider)
    const json: unknown = JSON.parse(decrypt(row.payload))
    await handler(json, { receivedAt: row.receivedAt, inboxId: id })
    await db.webhookInbox.update({ where: { id }, data: { processedAt: new Date(), lockedUntil: null, lastError: null } })
    if (row.attempts > 1) inboxLog('info', 'reprocessado', { id, provider: row.provider, tentativa: row.attempts })
    return 'processed'
  } catch (e) {
    const dead = row.attempts >= INBOX_MAX_ATTEMPTS
    const lastError = shortErr(e)
    try {
      await db.webhookInbox.update({
        where: { id },
        data: dead
          ? { deadAt: new Date(), lockedUntil: null, lastError }
          : { nextAttemptAt: new Date(Date.now() + inboxBackoffMs(row.attempts)), lockedUntil: null, lastError },
      })
    } catch (e2) {
      // Banco fora: a reserva expira sozinha e a linha volta a ser tentada.
      inboxLog('error', 'falha-ao-registrar-erro', { id, provider: row.provider, erro: shortErr(e2) })
    }
    inboxLog(dead ? 'error' : 'warn', dead ? 'desistiu' : 'falhou', { id, provider: row.provider, tentativa: row.attempts, erro: lastError })
    return dead ? 'dead' : 'retry'
  }
}

/**
 * Drena o que está pendente (falhou antes, ou o processo caiu entre o 200 e o processamento), na ordem de chegada.
 * Chamado pelo agendador a cada ciclo e na subida do servidor. Devolve quantas linhas foram processadas com sucesso.
 */
export async function drainInbox(opts: { limit?: number; shouldStop?: () => boolean } = {}): Promise<number> {
  const now = new Date()
  const rows = await db.webhookInbox.findMany({
    where: { processedAt: null, deadAt: null, nextAttemptAt: { lte: now }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
    orderBy: { receivedAt: 'asc' },
    take: opts.limit ?? 50,
    select: { id: true },
  })
  let ok = 0
  for (const r of rows) {
    if (opts.shouldStop?.()) break
    if ((await processInboxRow(r.id)) === 'processed') ok++
  }
  return ok
}

/** Retenção: apaga processadas antigas e mortas muito antigas. Devolve quantas apagou. */
export async function pruneInbox(now = new Date()): Promise<number> {
  const r = await db.webhookInbox.deleteMany({
    where: {
      OR: [
        { processedAt: { lt: new Date(now.getTime() - KEEP_PROCESSED_MS) } },
        { deadAt: { lt: new Date(now.getTime() - KEEP_DEAD_MS) } },
      ],
    },
  })
  return r.count
}

/** Para o /api/health e os testes: pendentes, mortas e a idade da pendente mais antiga. */
export async function inboxStats(): Promise<{ pendentes: number; mortas: number; maisAntigaSeg: number | null }> {
  const [pendentes, mortas, oldest] = await Promise.all([
    db.webhookInbox.count({ where: { processedAt: null, deadAt: null } }),
    db.webhookInbox.count({ where: { deadAt: { not: null } } }),
    db.webhookInbox.findFirst({ where: { processedAt: null, deadAt: null }, orderBy: { receivedAt: 'asc' }, select: { receivedAt: true } }),
  ])
  return { pendentes, mortas, maisAntigaSeg: oldest ? Math.round((Date.now() - oldest.receivedAt.getTime()) / 1000) : null }
}

// ---- Fila em processo (aceleração): processa logo depois de gravar, em ordem, sem estourar o pool ----

const gq = globalThis as unknown as { __pearchat_inbox_chain?: Promise<void>; __pearchat_inbox_queued?: number }
/** Acima disto não enfileira mais em memória: o agendador drena pela tabela (nada se perde, só atrasa). */
const MAX_QUEUED = 200

/** Agenda o processamento da linha em segundo plano (ordem de chegada). Nunca lança. */
export function kickInboxRow(id: string): void {
  const queued = gq.__pearchat_inbox_queued ?? 0
  if (queued >= MAX_QUEUED) return
  gq.__pearchat_inbox_queued = queued + 1
  const prev = gq.__pearchat_inbox_chain ?? Promise.resolve()
  gq.__pearchat_inbox_chain = prev
    .then(() => processInboxRow(id))
    .then(
      () => undefined,
      (e) => inboxLog('error', 'fila-em-processo', { id, erro: shortErr(e) }),
    )
    .finally(() => {
      gq.__pearchat_inbox_queued = Math.max(0, (gq.__pearchat_inbox_queued ?? 1) - 1)
    })
}

/** Espera a fila em processo esvaziar (desligamento gracioso e testes). */
export async function inboxQueueIdle(): Promise<void> {
  await (gq.__pearchat_inbox_chain ?? Promise.resolve())
}

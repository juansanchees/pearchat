import { createHash, timingSafeEqual } from 'node:crypto'
import { db } from '@/lib/db'

// Peças compartilhadas por /api/health (detalhes para o monitor da VPS) e /api/health/check (monitor externo).

/** Token curto demais é tratado como "não configurado": o endpoint protegido responde 404 (nada de token adivinhável). */
const TOKEN_MIN_LEN = 16

/** Compara o token recebido com HEALTH_TOKEN em tempo constante (hash de tamanho fixo). */
export function tokenMatches(given: string | null | undefined): boolean {
  const expected = process.env.HEALTH_TOKEN?.trim().replace(/^['"]|['"]$/g, '')
  if (!expected || expected.length < TOKEN_MIN_LEN || !given) return false
  const a = createHash('sha256').update(given).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const t = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error('timeout')), ms)
  })
  return Promise.race([p, t]).finally(() => clearTimeout(timer))
}

// Tabela da caixa de entrada de webhooks (criada pelo trabalho de robustez; o nome pode variar). Tolerante à ausência:
// se nenhuma existir, devolve inboxTabela:"ausente". Só usa colunas conhecidas (lista fixa), nunca texto vindo de fora.
const INBOX_TABLES = ['WebhookInbox', 'WebhookEvent', 'InboundWebhook'] as const
const INBOX_DONE_COLS = ['processedAt', 'processed_at', 'handledAt'] as const
const INBOX_TIME_COLS = ['createdAt', 'receivedAt'] as const

/** Caixa de entrada de webhooks: pendentes e idade do mais antigo, ou "ausente" se a tabela ainda não existe. */
export async function inboxStats(): Promise<{ inboxTabela: string; inboxPendentes: number; inboxMaisAntigoSeg: number }> {
  for (const table of INBOX_TABLES) {
    const reg = await db.$queryRawUnsafe<{ existe: boolean }[]>(`SELECT to_regclass(current_schema() || '."${table}"') IS NOT NULL AS existe`)
    if (!reg[0]?.existe) continue
    const cols = (
      await db.$queryRawUnsafe<{ column_name: string }[]>(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${table}'`,
      )
    ).map((c) => c.column_name)
    const done = INBOX_DONE_COLS.find((c) => cols.includes(c))
    const time = INBOX_TIME_COLS.find((c) => cols.includes(c))
    const where = done ? `WHERE "${done}" IS NULL` : ''
    const rows = await db.$queryRawUnsafe<{ n: number; idade: number | null }[]>(
      time
        ? `SELECT count(*)::int AS n, EXTRACT(EPOCH FROM (now() - min("${time}")))::int AS idade FROM "${table}" ${where}`
        : `SELECT count(*)::int AS n, NULL::int AS idade FROM "${table}" ${where}`,
    )
    // Sem coluna de "processado" não dá para saber o que está pendente: devolve só o total e idade 0 (o monitor ignora).
    return { inboxTabela: table, inboxPendentes: rows[0]?.n ?? 0, inboxMaisAntigoSeg: done ? (rows[0]?.idade ?? 0) : 0 }
  }
  return { inboxTabela: 'ausente', inboxPendentes: 0, inboxMaisAntigoSeg: 0 }
}

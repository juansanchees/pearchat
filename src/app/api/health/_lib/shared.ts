import { createHash, timingSafeEqual } from 'node:crypto'
import { db } from '@/lib/db'
import { inboxStats as inboxCounts } from '@/server/whatsapp/inbox'

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

// Caixa de entrada de webhooks (tabela WebhookInbox, criada pela onda 1B). Só contagens e idade; o corpo (cifrado) nunca é lido.
// "Mortas" ficam 30 dias guardadas para diagnóstico: o alarme olha só as das últimas 24 h (senão o monitor ficaria vermelho
// por um mês depois de uma falha já tratada); o total aparece no detalhe com token.
const DEAD_RECENT_MS = 24 * 3_600_000

export type InboxHealth = {
  inboxTabela: string
  inboxPendentes: number
  inboxMaisAntigoSeg: number
  inboxMortas: number
  inboxMortas24h: number
}

/** Pendentes, mortas e idade da pendente mais antiga da WebhookInbox. Lança se o banco falhar (quem chama trata). */
export async function inboxStats(): Promise<InboxHealth> {
  const [c, mortas24h] = await Promise.all([
    inboxCounts(),
    db.webhookInbox.count({ where: { deadAt: { gte: new Date(Date.now() - DEAD_RECENT_MS) } } }),
  ])
  return {
    inboxTabela: 'WebhookInbox',
    inboxPendentes: c.pendentes,
    inboxMaisAntigoSeg: c.maisAntigaSeg ?? 0,
    inboxMortas: c.mortas,
    inboxMortas24h: mortas24h,
  }
}

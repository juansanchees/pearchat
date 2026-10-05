// Regras comuns aos webhooks da Evolution e da Meta (antes duplicadas nas duas rotas).

/** Resposta do celular mais velha que isto não assume a conversa (é tratada como histórico). */
export const OUTBOUND_TAKEOVER_MAX_AGE_MS = 10 * 60_000

/**
 * Mensagem enviada pelo celular do dono só "assume" a conversa (HUMANO) se for recente e posterior à conexão; as antigas
 * que chegam pelo mesmo evento são histórico (gravadas como importadas, sem assumir).
 */
export function phoneReplyTakesOver(timestamp: Date, connectedAt: Date | null, now = Date.now()): boolean {
  const age = now - timestamp.getTime()
  const afterConnect = !connectedAt || timestamp.getTime() >= connectedAt.getTime() - 60_000
  return age < OUTBOUND_TAKEOVER_MAX_AGE_MS && afterConnect
}

/** Junta as falhas de um lote: processa TODOS os itens e só no fim lança (a caixa de entrada repete; tudo é idempotente). */
export class BatchFailure extends Error {
  constructor(
    public readonly failed: number,
    public readonly total: number,
    first: unknown,
  ) {
    super(`${failed} de ${total} item(ns) falharam: ${first instanceof Error ? first.message : 'erro'}`.slice(0, 300))
    this.name = 'BatchFailure'
  }
}

export async function eachIsolated<T>(items: T[], fn: (item: T) => Promise<void>, failures: unknown[]): Promise<void> {
  for (const it of items) {
    try {
      await fn(it)
    } catch (e) {
      failures.push(e)
    }
  }
}

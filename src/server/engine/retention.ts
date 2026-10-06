import { db } from '@/lib/db'

// Retenção do histórico do motor (M13): jobs de IA FINALIZADOS muito antigos só deixam as consultas do agendador mais
// lentas. Nada pendente/em andamento é apagado. Quem lê jobs de IA antigos olha no máximo 24 h (varredura) e 15 min
// (aviso de escrita descartada). Os jobs de follow-up NÃO são apagados: a contagem de tentativas do ciclo depende deles.

const KEEP_MS = 60 * 24 * 3_600_000
const BATCH = 5_000

/** Apaga jobs de IA finalizados há mais de 60 dias (um lote por chamada). Devolve quantos apagou. */
export async function pruneEngineHistory(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - KEEP_MS)
  const ai = await db.aiJob.findMany({ where: { status: { in: ['feito', 'erro'] }, createdAt: { lt: cutoff } }, select: { id: true }, take: BATCH })
  if (ai.length === 0) return 0
  const r = await db.aiJob.deleteMany({ where: { id: { in: ai.map((x) => x.id) } } })
  return r.count
}

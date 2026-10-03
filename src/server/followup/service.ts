import { z } from 'zod'
import { db } from '@/lib/db'
import type { FollowUpDTO, FollowUpQueueItemDTO } from '@/lib/types'

export const FU_MENSAGENS_PADRAO = [
  'Oi, {primeiro_nome}! Conseguiu ver minha última mensagem? Fico à disposição para o que precisar.',
  'Oi, {primeiro_nome}! Ainda posso ajudar com o que você procurava? Se preferir, é só me chamar por aqui.',
  'Oi, {primeiro_nome}! Vou encerrar por aqui para não incomodar. Quando quiser retomar, é só mandar uma mensagem.',
]
export const FU_PARAR_PADRAO = ['Cliente respondeu', 'Pedido fechado']

export const followUpSchema = z.object({
  esperaHoras: z.union([z.literal(2), z.literal(6), z.literal(24)]),
  tentativas: z.number().int().min(1).max(3),
  mensagens: z.array(z.string().max(1000)).min(1).max(3),
  stopConditions: z.array(z.enum(['Cliente respondeu', 'Pedido fechado', 'Cliente pediu para parar'])).max(3),
})
export type FollowUpUpdate = z.infer<typeof followUpSchema>

type RuleRow = { esperaHoras: number; tentativas: number; mensagens: string[]; stopConditions: string[] }

function toDTO(r: RuleRow, novo: boolean): FollowUpDTO {
  const espera = [2, 6, 24].includes(r.esperaHoras) ? r.esperaHoras : 24
  const tent = Math.min(3, Math.max(1, r.tentativas))
  // Sempre 3 textos (a tela guarda 3 e mostra as N primeiras); completa com os padrões.
  const mensagens = Array.from({ length: 3 }, (_, i) => (r.mensagens[i]?.trim() ? r.mensagens[i] : FU_MENSAGENS_PADRAO[i]))
  return {
    esperaHoras: espera as 2 | 6 | 24,
    tentativas: tent as 1 | 2 | 3,
    mensagens,
    stopConditions: novo ? FU_PARAR_PADRAO : r.stopConditions,
  }
}

export async function getFollowUp(workspaceId: string): Promise<FollowUpDTO> {
  const rule = await db.followUpRule.upsert({ where: { workspaceId }, create: { workspaceId }, update: {} })
  // Regra recém-criada (sem textos): mostra os padrões da spec.
  return toDTO(rule, rule.mensagens.length === 0 && rule.stopConditions.length === 0)
}

export async function updateFollowUp(workspaceId: string, input: FollowUpUpdate): Promise<FollowUpDTO> {
  const mensagens = Array.from({ length: 3 }, (_, i) => input.mensagens[i] ?? FU_MENSAGENS_PADRAO[i])
  const data = { esperaHoras: input.esperaHoras, tentativas: input.tentativas, mensagens, stopConditions: input.stopConditions }
  const rule = await db.followUpRule.upsert({ where: { workspaceId }, create: { workspaceId, ...data }, update: data })
  return toDTO(rule, false)
}

const sigla = (nome: string) =>
  nome
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')

/** Status do FollowUpJob esperado pelo job de follow-up (próxima etapa). */
export const FOLLOWUP_JOB_PENDENTE = 'pendente'

/** Próximos envios: jobs de follow-up pendentes do workspace (o job que os cria vem na próxima etapa). */
export async function getFollowUpQueue(workspaceId: string): Promise<FollowUpQueueItemDTO[]> {
  const jobs = await db.followUpJob.findMany({
    where: { status: FOLLOWUP_JOB_PENDENTE, conversation: { workspaceId } },
    orderBy: { runAt: 'asc' },
    take: 20,
    include: { conversation: { select: { contact: { select: { nome: true } } } } },
  })
  return jobs.map((j) => ({
    id: j.id,
    nome: j.conversation.contact.nome,
    sigla: sigla(j.conversation.contact.nome),
    tentativa: j.tentativa,
    runAt: j.runAt.toISOString(),
  }))
}

export async function countFollowUpQueue(workspaceId: string): Promise<number> {
  return db.followUpJob.count({ where: { status: FOLLOWUP_JOB_PENDENTE, conversation: { workspaceId } } })
}

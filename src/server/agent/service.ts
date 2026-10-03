import { z } from 'zod'
import { db } from '@/lib/db'
import type { AgentDTO, AgentHorario, AgentTestResultDTO, AgentTom, KnowledgeItemDTO } from '@/lib/types'
import { detectHandoff, generateReply, hasLlmKey, simulateReply } from './llm'
import { buildSystemPrompt, HANDOFF_MARKER } from './prompt'

// Valores no banco (slugs) <-> rótulos da interface.
const TOM_DB: Record<AgentTom, string> = { Amigável: 'amigavel', Profissional: 'profissional', Direto: 'direto' }
const HORARIO_DB: Record<AgentHorario, string> = { Sempre: 'sempre', 'Fora do expediente': 'fora_expediente', 'Só fins de semana': 'fins_de_semana' }
const invert = <K extends string>(m: Record<K, string>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [v, k])) as Record<string, K>
const TOM_FROM_DB = invert(TOM_DB)
const HORARIO_FROM_DB = invert(HORARIO_DB)

/** Prompt padrão (spec 05) quando o agente ainda não tem instruções salvas. */
export function defaultPrompt(nome: string, empresa: string): string {
  return `Você é ${nome}, atendente virtual de ${empresa}. Responda de forma calorosa e objetiva, em até 3 frases. Antes de fechar uma encomenda, confirme os detalhes do pedido. Não ofereça descontos; se o cliente pedir, passe a conversa para o dono do negócio.`
}

export const agentUpdateSchema = z.object({
  nome: z.string().trim().min(1, 'Informe o nome do agente').max(60),
  tom: z.enum(['Amigável', 'Profissional', 'Direto']),
  prompt: z.string().max(4000),
  horario: z.enum(['Sempre', 'Fora do expediente', 'Só fins de semana']),
  handoffRules: z.array(z.string().trim().min(1).max(120)).max(20),
  canSchedule: z.boolean().optional(),
})
export type AgentUpdate = z.infer<typeof agentUpdateSchema>

export const knowledgeSchema = z.object({
  pergunta: z.string().trim().min(1, 'Informe a pergunta').max(300),
  resposta: z.string().trim().min(1, 'Informe a resposta').max(1000),
})

export const agentTestSchema = z.object({
  mensagem: z.string().trim().min(1).max(1000),
  // Valores ainda não salvos que estão na tela (opcionais): o teste reflete o que o usuário vê.
  nome: z.string().trim().min(1).max(60).optional(),
  tom: z.enum(['Amigável', 'Profissional', 'Direto']).optional(),
  prompt: z.string().max(4000).optional(),
  handoffRules: z.array(z.string().max(120)).max(20).optional(),
})

function toAgentDTO(a: { nome: string; tom: string; prompt: string; horario: string; handoffRules: string[]; canSchedule: boolean }): AgentDTO {
  return {
    nome: a.nome,
    tom: TOM_FROM_DB[a.tom] ?? 'Amigável',
    prompt: a.prompt,
    horario: HORARIO_FROM_DB[a.horario] ?? 'Sempre',
    handoffRules: a.handoffRules,
    canSchedule: a.canSchedule,
  }
}

async function ensureAgent(workspaceId: string) {
  return db.aiAgent.upsert({ where: { workspaceId }, create: { workspaceId }, update: {} })
}

export async function getAgent(workspaceId: string): Promise<AgentDTO> {
  const [agent, ws] = await Promise.all([
    ensureAgent(workspaceId),
    db.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { nome: true } }),
  ])
  const dto = toAgentDTO(agent)
  // Prompt vazio no banco: mostra o padrão (só como valor inicial; só vira dado ao salvar).
  if (!dto.prompt.trim()) dto.prompt = defaultPrompt(dto.nome, ws.nome)
  return dto
}

export async function updateAgent(workspaceId: string, input: AgentUpdate): Promise<AgentDTO> {
  const data = {
    nome: input.nome,
    tom: TOM_DB[input.tom],
    prompt: input.prompt,
    horario: HORARIO_DB[input.horario],
    handoffRules: input.handoffRules,
    ...(input.canSchedule === undefined ? {} : { canSchedule: input.canSchedule }),
  }
  const agent = await db.aiAgent.upsert({ where: { workspaceId }, create: { workspaceId, ...data }, update: data })
  return toAgentDTO(agent)
}

// ---- Base de conhecimento (pares pergunta/resposta) ----

export async function listKnowledge(workspaceId: string): Promise<KnowledgeItemDTO[]> {
  const agent = await ensureAgent(workspaceId)
  const rows = await db.knowledgeItem.findMany({ where: { agentId: agent.id }, orderBy: { createdAt: 'asc' } })
  return rows.map((r) => ({ id: r.id, pergunta: r.pergunta, resposta: r.resposta }))
}

export async function addKnowledge(workspaceId: string, input: z.infer<typeof knowledgeSchema>): Promise<KnowledgeItemDTO> {
  const agent = await ensureAgent(workspaceId)
  const r = await db.knowledgeItem.create({ data: { agentId: agent.id, pergunta: input.pergunta, resposta: input.resposta } })
  return { id: r.id, pergunta: r.pergunta, resposta: r.resposta }
}

/** Atualiza um par. Devolve null se o id não pertence ao workspace. */
export async function updateKnowledge(
  workspaceId: string,
  id: string,
  input: Partial<z.infer<typeof knowledgeSchema>>,
): Promise<KnowledgeItemDTO | null> {
  const owned = await db.knowledgeItem.findFirst({ where: { id, agent: { workspaceId } }, select: { id: true } })
  if (!owned) return null
  const r = await db.knowledgeItem.update({ where: { id }, data: input })
  return { id: r.id, pergunta: r.pergunta, resposta: r.resposta }
}

/** Remove um par. Devolve false se o id não pertence ao workspace. */
export async function deleteKnowledge(workspaceId: string, id: string): Promise<boolean> {
  const { count } = await db.knowledgeItem.deleteMany({ where: { id, agent: { workspaceId } } })
  return count > 0
}

// ---- Teste do agente ----

export async function testAgent(
  workspaceId: string,
  responsavelNome: string,
  input: z.infer<typeof agentTestSchema>,
): Promise<AgentTestResultDTO> {
  const [agent, kb, ws] = await Promise.all([
    getAgent(workspaceId),
    listKnowledge(workspaceId),
    db.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { nome: true } }),
  ])
  const nome = input.nome ?? agent.nome
  const tom = input.tom ?? agent.tom
  const prompt = input.prompt ?? agent.prompt
  const handoffRules = input.handoffRules ?? agent.handoffRules
  const responsavel = responsavelNome.trim().split(/\s+/)[0] || 'o responsável'

  const handoff = detectHandoff(input.mensagem, handoffRules, responsavel)
  if (handoff) return { resposta: handoff, handoff: true, simulado: !hasLlmKey() }

  const system = buildSystemPrompt({ empresa: ws.nome, agente: { nome, tom, prompt }, kb, handoffRules })
  const r = await generateReply({
    system,
    messages: [{ role: 'user', content: input.mensagem }],
    simulate: () => simulateReply(input.mensagem, tom, kb),
  })
  if (r.texto.includes(HANDOFF_MARKER)) {
    return { resposta: `Claro, já estou passando sua conversa para ${responsavel}.`, handoff: true, simulado: r.simulado }
  }
  return { resposta: r.texto, handoff: false, simulado: r.simulado }
}

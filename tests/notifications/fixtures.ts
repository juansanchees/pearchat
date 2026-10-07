// Ambiente dos testes do sininho: schema de teste exclusivo (pearchat_test_e), contador de consultas e dados semeados.
// IMPORTANTE: este arquivo precisa ser o PRIMEIRO import do teste (o cliente contado é criado antes de src/lib/db).
import { counted, queries } from './client'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { db } from '../../src/lib/db'
import { addDays, toZoned, zonedInstant } from '../../src/components/agenda/time'
import type { Contexto } from '../../src/server/notifications/service'

export { db }
assert.equal(db, counted)

/** Senha dos usuários de teste (só existem no schema de teste e são apagados no fim). */
export const SENHA = 'Senha-Forte-1'
const HASH = bcrypt.hashSync(SENHA, 4)

/** Executa `fn` e devolve quantas consultas SQL o cliente fez (inclui BEGIN/COMMIT). */
export async function contar<T>(fn: () => Promise<T>): Promise<{ valor: T; n: number; dados: number; sql: string[] }> {
  queries.length = 0
  const valor = await fn()
  await new Promise((r) => setTimeout(r, 20))
  const sql = [...queries]
  // "dados" = só as consultas de leitura/escrita do sininho (sem BEGIN/COMMIT nem o SELECT 1 de verificação de conexão do Prisma).
  return { valor, n: sql.length, dados: sql.filter((q) => !/^(BEGIN|COMMIT|SELECT 1)$/i.test(q.trim())).length, sql }
}

export const uniq = () => randomBytes(4).toString('hex')
export const ago = (min: number, now = Date.now()) => new Date(now - min * 60_000)

const createdUsers: string[] = []
const createdWorkspaces: string[] = []
const createdOrgs: string[] = []

export type World = Awaited<ReturnType<typeof makeWorld>>

/** Organização com 2 espaços (W1 principal, W2) e: dono, administrador e atendente (membro só de W1). Mais uma organização alheia. */
export async function makeWorld() {
  const tag = uniq()
  const org = await db.organization.create({ data: { nome: `Org ${tag}` } })
  createdOrgs.push(org.id)
  const w1 = await db.workspace.create({ data: { nome: `Loja ${tag}`, organizationId: org.id } })
  const w2 = await db.workspace.create({ data: { nome: `Filial ${tag}`, organizationId: org.id, ordem: 1 } })
  createdWorkspaces.push(w1.id, w2.id)
  const mk = async (papel: string, nome: string, ws = w1.id, organizationId: string | null = org.id) => {
    const u = await db.user.create({ data: { nome, email: `${papel}-${uniq()}@teste.local`, papel, workspaceId: ws, organizationId, passwordHash: HASH } })
    createdUsers.push(u.id)
    return u
  }
  const owner = await mk('owner', 'Dona')
  const admin = await mk('admin', 'Admin')
  const agent = await mk('agent', 'Atendente')
  await db.spaceMember.create({ data: { userId: agent.id, workspaceId: w1.id } })

  const orgB = await db.organization.create({ data: { nome: `Alheia ${tag}` } })
  createdOrgs.push(orgB.id)
  const w3 = await db.workspace.create({ data: { nome: `Alheio ${tag}`, organizationId: orgB.id } })
  createdWorkspaces.push(w3.id)
  const intruso = await mk('owner', 'Intruso', w3.id, orgB.id)

  const ctx = (u: { id: string; papel: string; email: string }, ws: string, organizationId: string | null = org.id): Contexto => ({
    userId: u.id,
    workspaceId: ws,
    organizationId,
    papel: u.papel as Contexto['papel'],
    email: u.email,
  })
  return { tag, org, orgB, w1, w2, w3, owner, admin, agent, intruso, ctx }
}

/** Remove tudo que os testes criaram (o schema é só de teste; as notificações saem em cascata). */
export async function cleanup(): Promise<void> {
  for (const id of createdUsers) await db.user.delete({ where: { id } }).catch(() => undefined)
  for (const id of createdWorkspaces) await db.workspace.delete({ where: { id } }).catch(() => undefined)
  for (const id of createdOrgs) await db.organization.delete({ where: { id } }).catch(() => undefined)
  await db.$disconnect()
}

let phone = 5511900000000 + Math.floor(Math.random() * 1_000_000) * 100
export type ConvSeed = {
  nome: string
  mode?: 'IA' | 'HUMANO' | null
  unread?: number
  /** Quando a conversa foi criada e recebeu a última mensagem (minutos atrás). */
  criadaMin?: number
  ultimaMin?: number
  assigneeId?: string | null
  /** Mensagem do cliente (corpo de teste, que NUNCA pode aparecer em notificação). */
  corpo?: string
  importada?: boolean
  semMensagem?: boolean
}

export async function seedConv(workspaceId: string, s: ConvSeed, now = Date.now()) {
  const contact = await db.contact.create({ data: { workspaceId, nome: s.nome, telefone: `+${++phone}` } })
  const ultima = ago(s.ultimaMin ?? 5, now)
  const conv = await db.conversation.create({
    data: {
      workspaceId,
      contactId: contact.id,
      mode: s.mode ?? null,
      unread: s.unread ?? 0,
      assigneeId: s.assigneeId ?? null,
      createdAt: ago(s.criadaMin ?? 3000, now),
      lastMessageAt: ultima,
    },
  })
  if (!s.semMensagem) {
    await db.message.create({
      data: { conversationId: conv.id, direction: 'IN', author: 'CLIENTE', body: s.corpo ?? 'SEGREDO-do-cliente-123', imported: s.importada ?? false, createdAt: ultima },
    })
  }
  return { contact, conv }
}

export async function seedAiJob(workspaceId: string, conversationId: string, o: { status?: 'feito' | 'erro' | 'executando' | 'pendente'; error?: string | null; runMin: number; ferramentas?: unknown }, now = Date.now()) {
  return db.aiJob.create({
    data: {
      workspaceId,
      conversationId,
      status: o.status ?? 'feito',
      error: o.error ?? null,
      runAt: ago(o.runMin, now),
      createdAt: ago(o.runMin + 0.1, now),
      ferramentas: o.ferramentas === undefined ? undefined : (o.ferramentas as never),
    },
  })
}

/** Amanhã às `hm` (horário de São Paulo), como instante. */
export function amanha(hm: string, now = new Date()): Date {
  const hoje = toZoned(now.toISOString()).date
  return new Date(zonedInstant(addDays(hoje, 1), hm))
}
export const diaSp = (d: Date) => toZoned(d.toISOString()).date

export async function seedEvent(
  workspaceId: string,
  contactId: string | null,
  o: { origem?: 'IA' | 'MANUAL' | 'GOOGLE'; canal?: string | null; inicio?: Date; criadoMin?: number; status?: string; canceladoMin?: number; canceladoPor?: string; confirmacao?: string; confirmadoMin?: number; atualizadoMin?: number },
  now = Date.now(),
) {
  const criado = ago(o.criadoMin ?? 3, now)
  return db.event.create({
    data: {
      workspaceId,
      contactId,
      inicio: o.inicio ?? amanha('16:00', new Date(now)),
      duracaoMin: 60,
      titulo: 'Corte',
      tipo: 'Corte',
      origem: o.origem ?? 'IA',
      canal: o.canal ?? null,
      status: o.status ?? 'ativo',
      canceladoEm: o.canceladoMin !== undefined ? ago(o.canceladoMin, now) : null,
      canceladoPor: o.canceladoPor ?? null,
      confirmacao: o.confirmacao ?? 'pendente',
      confirmadoEm: o.confirmadoMin !== undefined ? ago(o.confirmadoMin, now) : null,
      createdAt: criado,
      updatedAt: o.atualizadoMin !== undefined ? ago(o.atualizadoMin, now) : criado,
    },
  })
}

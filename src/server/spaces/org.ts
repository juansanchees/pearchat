import { Prisma } from '@prisma/client'
import type { Plan } from '@prisma/client'
import { db } from '@/lib/db'

// Camada Organization: cada WhatsApp é um Workspace (espaço) e a Organization agrupa os espaços da conta,
// sendo a dona do plano/assinatura. Colunas organizationId ficam NULÁVEIS no banco (migração segura com o
// app antigo rodando): o código trata nulo criando a organização sob demanda (ensureOrganization).

export const PLAN_NAME: Record<Plan, 'Essencial' | 'Pro' | 'Negócios'> = { ESSENCIAL: 'Essencial', PRO: 'Pro', NEGOCIOS: 'Negócios' }

/** Quantos WhatsApps (espaços não arquivados) cada plano permite. */
export const PLAN_SPACE_LIMIT: Record<Plan, number> = { ESSENCIAL: 1, PRO: 3, NEGOCIOS: 5 }

const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'

/** Id determinístico usado pelo backfill da migração 0008 e por este código (duas corridas convergem na mesma linha). */
export const orgIdForWorkspace = (workspaceId: string) => `org_${workspaceId}`

/**
 * Garante que o workspace (e os usuários dele) tenham organização. Idempotente e seguro sob concorrência:
 * o id da organização é derivado do workspace, então duas chamadas simultâneas criam/leem a mesma linha.
 */
export async function ensureOrganization(workspaceId: string): Promise<string> {
  const ws = await db.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: { organizationId: true, nome: true, plano: true, statusAssinatura: true, createdAt: true },
  })
  let orgId = ws.organizationId
  if (!orgId) {
    orgId = orgIdForWorkspace(workspaceId)
    try {
      await db.organization.create({
        data: { id: orgId, nome: ws.nome, plano: ws.plano, statusAssinatura: ws.statusAssinatura, createdAt: ws.createdAt },
      })
    } catch (e) {
      if (!isUnique(e)) throw e
    }
    await db.workspace.updateMany({ where: { id: workspaceId, organizationId: null }, data: { organizationId: orgId } })
    // Outra chamada pode ter vencido a corrida com outro id: vale o que ficou gravado.
    const again = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { organizationId: true } })
    orgId = again.organizationId ?? orgId
  }
  await db.user.updateMany({ where: { workspaceId, organizationId: null }, data: { organizationId: orgId } })
  return orgId
}

// Cache curtíssimo (por processo) do espaço ativo: evita uma consulta ao banco em CADA chamada de auth()/socket.
// Trocar de espaço, arquivar e criar organização invalidam na hora (invalidateActiveSpace); fora disso a janela
// de defasagem é de no máximo ACTIVE_CACHE_MS. ACTIVE_SPACE_CACHE_MS=0 desliga (os testes que mexem direto no banco).
const ACTIVE_CACHE_MS = Number(process.env.ACTIVE_SPACE_CACHE_MS ?? 2000)
// Em globalThis: o server.ts e cada bundle de rota do Next são módulos distintos no mesmo processo.
const holder = globalThis as unknown as { __pearchat_active_cache?: Map<string, { value: ActiveSpace; exp: number }> }
const activeCache = (holder.__pearchat_active_cache ??= new Map())
export function invalidateActiveSpace(userId?: string): void {
  if (userId) activeCache.delete(userId)
  else activeCache.clear()
}

export type ActiveSpace = { userId: string; workspaceId: string; organizationId: string; sessionVersion: number }

/**
 * Espaço ativo do usuário, lido do BANCO (a fonte da verdade; o JWT pode estar desatualizado após uma troca).
 * Garante que o workspace ativo pertence à organização do usuário e não está arquivado; senão cai no primeiro
 * espaço ativo da organização e grava a correção. null = usuário não existe.
 */
export async function resolveActiveSpace(userId: string): Promise<ActiveSpace | null> {
  const hit = activeCache.get(userId)
  if (hit && hit.exp > Date.now()) return hit.value
  const value = await resolveActiveSpaceUncached(userId)
  if (value && ACTIVE_CACHE_MS > 0) activeCache.set(userId, { value, exp: Date.now() + ACTIVE_CACHE_MS })
  return value
}

async function resolveActiveSpaceUncached(userId: string): Promise<ActiveSpace | null> {
  const u = await db.user.findUnique({
    where: { id: userId },
    select: { workspaceId: true, organizationId: true, sessionVersion: true, workspace: { select: { organizationId: true, arquivadoEm: true } } },
  })
  if (!u) return null

  let orgId = u.organizationId ?? u.workspace.organizationId
  if (!orgId) {
    orgId = await ensureOrganization(u.workspaceId)
  } else {
    if (!u.organizationId) await db.user.updateMany({ where: { id: userId, organizationId: null }, data: { organizationId: orgId } })
    if (!u.workspace.organizationId) {
      await db.workspace.updateMany({ where: { id: u.workspaceId, organizationId: null }, data: { organizationId: orgId } })
      u.workspace.organizationId = orgId
    }
  }

  if (u.workspace.organizationId === orgId && !u.workspace.arquivadoEm) {
    return { userId, workspaceId: u.workspaceId, organizationId: orgId, sessionVersion: u.sessionVersion }
  }
  const fallback = await db.workspace.findFirst({
    where: { organizationId: orgId, arquivadoEm: null },
    orderBy: [{ ordem: 'asc' }, { createdAt: 'asc' }],
    select: { id: true },
  })
  // Sem nenhum espaço válido na organização (inconsistência): mantém o que está gravado.
  if (!fallback) return { userId, workspaceId: u.workspaceId, organizationId: orgId, sessionVersion: u.sessionVersion }
  await db.user.update({ where: { id: userId }, data: { workspaceId: fallback.id, organizationId: orgId } })
  return { userId, workspaceId: fallback.id, organizationId: orgId, sessionVersion: u.sessionVersion }
}

export type OrgScope = {
  organizationId: string | null
  plano: Plan
  /** Todos os workspaces da organização (inclusive arquivados: o uso deles no mês conta). */
  workspaceIds: string[]
}

/** Plano e conjunto de workspaces cujo uso se soma. Sem organização, vale o próprio workspace (fallback legado). */
export async function getOrgScope(workspaceId: string): Promise<OrgScope> {
  const ws = await db.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: { plano: true, organizationId: true, organization: { select: { plano: true } } },
  })
  if (!ws.organizationId || !ws.organization) return { organizationId: null, plano: ws.plano, workspaceIds: [workspaceId] }
  const all = await db.workspace.findMany({ where: { organizationId: ws.organizationId }, select: { id: true } })
  const ids = all.map((w) => w.id)
  if (!ids.includes(workspaceId)) ids.push(workspaceId)
  return { organizationId: ws.organizationId, plano: ws.organization.plano, workspaceIds: ids }
}

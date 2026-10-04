import { db } from '@/lib/db'
import { normalizePapel, PermissionError } from '@/server/auth/permissions'
import type { Papel } from '@/server/auth/permissions'

/**
 * Espaços (não arquivados) que a pessoa pode operar: dono/administrador = todos da organização;
 * atendente = só os em que é membro. `null` = sem restrição por lista (todos da organização).
 */
export async function allowedWorkspaceIds(userId: string, papel: Papel): Promise<string[] | null> {
  if (papel !== 'agent') return null
  const rows = await db.spaceMember.findMany({
    where: { userId, workspace: { arquivadoEm: null } },
    select: { workspaceId: true },
  })
  return rows.map((r) => r.workspaceId)
}

/** Pessoas ativas com acesso a um espaço (para o seletor de responsável e os avisos): donos, admins e atendentes membros. */
export async function peopleWithAccess(workspaceId: string, organizationId: string) {
  return db.user.findMany({
    where: {
      organizationId,
      desativadoEm: null,
      OR: [{ papel: { in: ['owner', 'admin'] } }, { spaceMemberships: { some: { workspaceId } } }],
    },
    orderBy: [{ nome: 'asc' }],
    select: { id: true, nome: true, fotoUrl: true, image: true, papel: true },
  })
}

/**
 * O usuário pode operar este espaço? Dono/administrador: qualquer espaço (não arquivado) da própria organização.
 * Atendente: só os espaços em que é membro (SpaceMember). Usuário desativado: nenhum.
 */
export async function userCanAccessSpace(userId: string, workspaceId: string): Promise<boolean> {
  const [u, ws] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { papel: true, organizationId: true, desativadoEm: true } }),
    db.workspace.findUnique({ where: { id: workspaceId }, select: { organizationId: true, arquivadoEm: true } }),
  ])
  if (!u || u.desativadoEm || !ws || ws.arquivadoEm || !u.organizationId || ws.organizationId !== u.organizationId) return false
  if (normalizePapel(u.papel) !== 'agent') return true
  return (await db.spaceMember.count({ where: { userId, workspaceId } })) > 0
}

/** Lança PermissionError se a pessoa não pode operar o espaço. */
export async function requireSpaceAccess(userId: string, workspaceId: string): Promise<void> {
  if (!(await userCanAccessSpace(userId, workspaceId))) throw new PermissionError('Você não tem acesso a este WhatsApp')
}

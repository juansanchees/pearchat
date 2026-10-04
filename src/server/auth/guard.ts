import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { can, PermissionError } from './permissions'
import type { Action } from './permissions'

export { requireSpaceAccess, userCanAccessSpace } from '@/server/team/access'

const deny401 = () => NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
const deny403 = () => NextResponse.json({ error: 'Você não tem permissão para isso', code: 'SEM_PERMISSAO' }, { status: 403 })

/**
 * Chamada de UMA linha no topo de cada handler sensível:
 *   const deny = await denyUnless('campaigns.manage'); if (deny) return deny
 * 401 sem sessão (ou sessão revogada/usuário desativado), 403 se o papel da sessão não tem a ação.
 * O papel vem do BANCO a cada leitura da sessão (callback `session` em src/auth.ts): rebaixar vale na próxima requisição.
 * O espaço da sessão também vem do banco e, para atendente, só pode ser um espaço em que ele é membro.
 */
export async function denyUnless(action: Action): Promise<NextResponse | null> {
  const session = await auth()
  if (!session?.user?.userId || !session.user.workspaceId) return deny401()
  return can(session.user, action) ? null : deny403()
}

/** Resposta para um PermissionError lançado por requirePermission/requireRole/requireSpaceAccess. */
export function permissionResponse(e: unknown): NextResponse {
  if (e instanceof PermissionError) return deny403()
  throw e
}

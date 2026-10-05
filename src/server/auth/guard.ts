import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { emailGateBlocks } from '@/server/mail/email-verification'
import { unauthorizedResponse } from './availability'
import { can, PermissionError } from './permissions'
import type { Action } from './permissions'

export { requireSpaceAccess, userCanAccessSpace } from '@/server/team/access'

const deny401 = unauthorizedResponse // 401, ou 503 se o banco não deixou conferir a sessão (availability.ts)
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
  if (!can(session.user, action)) return deny403()
  // E-mail ainda não confirmado (só vale com serviço de e-mail configurado e para contas novas): ações que gastam IA,
  // mandam mensagens, convidam pessoas ou conectam o WhatsApp ficam bloqueadas no servidor, não só na tela.
  if (REQUIRES_VERIFIED_EMAIL.has(action) && (await emailGateBlocks(session.user.userId))) return denyUnverified()
  return null
}

/** Ações que exigem e-mail confirmado (quando a confirmação é exigível para a conta). Leitura e ajustes locais não. */
const REQUIRES_VERIFIED_EMAIL: ReadonlySet<Action> = new Set<Action>([
  'conversations.use', // resposta da IA em uma conversa, atribuição
  'agent.manage', // "Testar o agente" (custo de IA) e aprovação de respostas da IA
  'automations.toggle',
  'followup.manage',
  'campaigns.manage', // disparos em massa
  'wa.manage', // conectar WhatsApp
  'team.manage', // convidar pessoas
  'spaces.manage',
  'booking.manage', // abre um link público que dispara WhatsApp
  'calendar.manage',
  'billing.manage',
])

export const denyUnverified = () =>
  NextResponse.json({ error: 'Confirme seu e-mail para continuar.', code: 'EMAIL_NAO_VERIFICADO' }, { status: 403 })

/** Para rotas que autenticam por `sessionIds()`/`apiSession()` e enviam mensagens: 403 se o e-mail precisa ser confirmado. */
export async function denyIfEmailUnverified(userId: string): Promise<NextResponse | null> {
  return (await emailGateBlocks(userId)) ? denyUnverified() : null
}

/** Resposta para um PermissionError lançado por requirePermission/requireRole/requireSpaceAccess. */
export function permissionResponse(e: unknown): NextResponse {
  if (e instanceof PermissionError) return deny403()
  throw e
}

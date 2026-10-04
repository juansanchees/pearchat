import { NextResponse } from 'next/server'
import { denyUnless } from '@/server/auth/guard'
import type { Action } from '@/server/auth/permissions'
import { apiSession, unauthorized } from '@/server/settings/http'
import { ensureOrganization } from '@/server/spaces/org'
import { BillingError, billingEnabled } from './config'
import type { Actor } from './service'

/**
 * Casca das rotas de cobrança do dono: permissão (billing.manage por padrão = só owner), organização SEMPRE da sessão,
 * 409 BILLING_OFF com a cobrança desligada e erros de negócio como JSON {error, code}.
 */
export async function billingRoute(action: Action, handler: (actor: Actor) => Promise<unknown>, opts: { needsBilling?: boolean; status?: number } = {}): Promise<NextResponse> {
  const deny = await denyUnless(action)
  if (deny) return deny
  const s = await apiSession()
  if (!s) return unauthorized()
  if (opts.needsBilling !== false && !billingEnabled()) {
    return NextResponse.json({ error: 'A cobrança não está ativa neste ambiente.', code: 'BILLING_OFF' }, { status: 409 })
  }
  try {
    const organizationId = s.organizationId ?? (await ensureOrganization(s.workspaceId))
    return NextResponse.json(await handler({ organizationId, userId: s.userId }), { status: opts.status ?? 200 })
  } catch (e) {
    if (e instanceof BillingError) return NextResponse.json({ error: e.message, code: e.code, ...(e.extra ?? {}) }, { status: e.status })
    throw e
  }
}

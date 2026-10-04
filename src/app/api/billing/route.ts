import { NextResponse } from 'next/server'
import { denyUnless } from '@/server/auth/guard'
import { apiSession, unauthorized } from '@/server/settings/http'
import { getCobranca } from '@/server/billing/service'
import { getBilling } from '@/server/settings/service'
import { ensureOrganization } from '@/server/spaces/org'

export const dynamic = 'force-dynamic'

// Plano atual, uso do mês e faturas. Troca de plano e de cartão ainda não existem (sem gateway).
export async function GET() {
  const deny = await denyUnless('billing.view'); if (deny) return deny
  const s = await apiSession()
  if (!s) return unauthorized()
  const billing = await getBilling(s.workspaceId)
  // Cobrança desligada (padrão): resposta idêntica à de antes. Ligada: acrescenta o bloco `cobranca`.
  const cobranca = await getCobranca(s.organizationId ?? (await ensureOrganization(s.workspaceId)))
  return NextResponse.json(cobranca ? { ...billing, cobranca } : billing)
}

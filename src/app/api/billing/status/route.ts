import { NextResponse } from 'next/server'
import { getBillingBanner } from '@/server/billing/service'
import { apiSession, unauthorized } from '@/server/settings/http'
import { ensureOrganization } from '@/server/spaces/org'

export const dynamic = 'force-dynamic'

// Estado mínimo para a faixa de aviso (qualquer pessoa logada da conta; sem valores, ids nem links).
export async function GET() {
  const s = await apiSession()
  if (!s) return unauthorized()
  const orgId = s.organizationId ?? (await ensureOrganization(s.workspaceId))
  return NextResponse.json(await getBillingBanner(orgId))
}

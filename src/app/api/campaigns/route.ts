import { NextResponse } from 'next/server'
import { denyUnless } from '@/server/auth/guard'
import { campaignSchema, CampaignError, createCampaign, listCampaigns } from '@/server/campaigns/service'
import { apiSession, fail, parseBody, unauthorized } from '@/server/settings/http'

export const dynamic = 'force-dynamic'

export async function GET() {
  const deny = await denyUnless('campaigns.manage'); if (deny) return deny
  const s = await apiSession()
  if (!s) return unauthorized()
  return NextResponse.json(await listCampaigns(s.workspaceId))
}

// Cria a campanha e a fila de destinatários. NÃO envia: o worker de disparos é a próxima etapa.
export async function POST(req: Request) {
  const deny = await denyUnless('campaigns.manage'); if (deny) return deny
  const s = await apiSession()
  if (!s) return unauthorized()
  const body = await parseBody(req, campaignSchema)
  if ('error' in body) return body.error
  try {
    return NextResponse.json(await createCampaign(s.workspaceId, body.data), { status: 201 })
  } catch (e) {
    if (e instanceof CampaignError) return fail(e.message, e.status)
    throw e
  }
}

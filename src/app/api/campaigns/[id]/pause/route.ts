import { NextResponse } from 'next/server'
import { denyUnless } from '@/server/auth/guard'
import { CampaignError, pauseCampaign } from '@/server/campaigns/service'
import { apiSession, fail, notFound, unauthorized } from '@/server/settings/http'

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const deny = await denyUnless('campaigns.manage'); if (deny) return deny
  const s = await apiSession()
  if (!s) return unauthorized()
  try {
    const c = await pauseCampaign(s.workspaceId, params.id)
    return c ? NextResponse.json(c) : notFound('Campanha')
  } catch (e) {
    if (e instanceof CampaignError) return fail(e.message, e.status)
    throw e
  }
}

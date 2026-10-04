import { NextResponse } from 'next/server'
import { denyUnless } from '@/server/auth/guard'
import { CampaignError, createTemplate, listTemplates, templateSchema } from '@/server/campaigns/service'
import { apiSession, fail, parseBody, unauthorized } from '@/server/settings/http'

export const dynamic = 'force-dynamic'

export async function GET() {
  const deny = await denyUnless('campaigns.manage'); if (deny) return deny
  const s = await apiSession()
  if (!s) return unauthorized()
  return NextResponse.json(await listTemplates(s.workspaceId))
}

// Cria um modelo "Em análise". O envio real à Meta (Graph API) vem na etapa do provedor oficial.
export async function POST(req: Request) {
  const deny = await denyUnless('campaigns.manage'); if (deny) return deny
  const s = await apiSession()
  if (!s) return unauthorized()
  const body = await parseBody(req, templateSchema)
  if ('error' in body) return body.error
  try {
    return NextResponse.json(await createTemplate(s.workspaceId, body.data), { status: 201 })
  } catch (e) {
    if (e instanceof CampaignError) return fail(e.message, e.status)
    throw e
  }
}

import { NextResponse } from 'next/server'
import { denyUnless } from '@/server/auth/guard'
import { disparosSettingsSchema, getDisparosSettings, updateDisparosSettings } from '@/server/campaigns/service'
import { apiSession, parseBody, unauthorized } from '@/server/settings/http'

export const dynamic = 'force-dynamic'

// Horário de silêncio dos disparos (não enviar entre X h e Y h, fuso do espaço, Workspace.timezone).
export async function GET() {
  const deny = await denyUnless('campaigns.manage'); if (deny) return deny
  const s = await apiSession()
  if (!s) return unauthorized()
  return NextResponse.json(await getDisparosSettings(s.workspaceId))
}

export async function PUT(req: Request) {
  const deny = await denyUnless('campaigns.manage'); if (deny) return deny
  const s = await apiSession()
  if (!s) return unauthorized()
  const body = await parseBody(req, disparosSettingsSchema)
  if ('error' in body) return body.error
  return NextResponse.json(await updateDisparosSettings(s.workspaceId, body.data))
}

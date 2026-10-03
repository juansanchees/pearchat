import { NextResponse } from 'next/server'
import { followUpSchema, getFollowUp, updateFollowUp } from '@/server/followup/service'
import { apiSession, parseBody, unauthorized } from '@/server/settings/http'

export const dynamic = 'force-dynamic'

export async function GET() {
  const s = await apiSession()
  if (!s) return unauthorized()
  return NextResponse.json(await getFollowUp(s.workspaceId))
}

export async function PUT(req: Request) {
  const s = await apiSession()
  if (!s) return unauthorized()
  const body = await parseBody(req, followUpSchema)
  if ('error' in body) return body.error
  return NextResponse.json(await updateFollowUp(s.workspaceId, body.data))
}

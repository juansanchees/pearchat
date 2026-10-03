import { NextResponse } from 'next/server'
import { apiSession, parseBody, unauthorized } from '@/server/settings/http'
import { agentUpdateSchema, getAgent, updateAgent } from '@/server/agent/service'

export const dynamic = 'force-dynamic'

export async function GET() {
  const s = await apiSession()
  if (!s) return unauthorized()
  return NextResponse.json(await getAgent(s.workspaceId))
}

export async function PUT(req: Request) {
  const s = await apiSession()
  if (!s) return unauthorized()
  const body = await parseBody(req, agentUpdateSchema)
  if ('error' in body) return body.error
  return NextResponse.json(await updateAgent(s.workspaceId, body.data))
}

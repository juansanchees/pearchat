import { NextResponse } from 'next/server'
import { apiSession, parseBody, unauthorized } from '@/server/settings/http'
import { addKnowledge, knowledgeSchema, listKnowledge } from '@/server/agent/service'

export const dynamic = 'force-dynamic'

export async function GET() {
  const s = await apiSession()
  if (!s) return unauthorized()
  return NextResponse.json(await listKnowledge(s.workspaceId))
}

export async function POST(req: Request) {
  const s = await apiSession()
  if (!s) return unauthorized()
  const body = await parseBody(req, knowledgeSchema)
  if ('error' in body) return body.error
  return NextResponse.json(await addKnowledge(s.workspaceId, body.data), { status: 201 })
}

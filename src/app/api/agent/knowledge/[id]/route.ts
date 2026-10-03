import { NextResponse } from 'next/server'
import { apiSession, notFound, parseBody, unauthorized } from '@/server/settings/http'
import { deleteKnowledge, knowledgeSchema, updateKnowledge } from '@/server/agent/service'

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const s = await apiSession()
  if (!s) return unauthorized()
  const body = await parseBody(req, knowledgeSchema.partial())
  if ('error' in body) return body.error
  const item = await updateKnowledge(s.workspaceId, params.id, body.data)
  return item ? NextResponse.json(item) : notFound('Resposta')
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const s = await apiSession()
  if (!s) return unauthorized()
  return (await deleteKnowledge(s.workspaceId, params.id)) ? NextResponse.json({ ok: true }) : notFound('Resposta')
}

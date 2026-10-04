import { NextResponse } from 'next/server'
import { unauthorized, parseBody } from '@/server/settings/http'
import { orgSession, spaceErrorResponse } from '@/server/spaces/http'
import { createSchema, createSpace, listSpaces } from '@/server/spaces/service'

export const dynamic = 'force-dynamic'

// GET: espaços (WhatsApps) não arquivados da organização do usuário, com status, não lidas e pendências.
export async function GET() {
  const s = await orgSession()
  if (!s) return unauthorized()
  return NextResponse.json(await listSpaces(s.organizationId, s.workspaceId))
}

// POST { nome }: cria um novo espaço, respeitando o limite do plano (403 + code LIMITE_PLANO).
export async function POST(req: Request) {
  const s = await orgSession()
  if (!s) return unauthorized()
  const body = await parseBody(req, createSchema)
  if ('error' in body) return body.error
  try {
    const created = await createSpace(s.organizationId, body.data.nome)
    return NextResponse.json(created, { status: 201 })
  } catch (e) {
    return spaceErrorResponse(e)
  }
}

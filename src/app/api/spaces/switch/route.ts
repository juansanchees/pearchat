import { NextResponse } from 'next/server'
import { unstable_update } from '@/auth'
import { notFound, parseBody, unauthorized } from '@/server/settings/http'
import { orgSession, spaceErrorResponse, validSpaceId } from '@/server/spaces/http'
import { switchSchema, switchSpace } from '@/server/spaces/service'

export const dynamic = 'force-dynamic'

// POST { workspaceId }: troca o espaço ativo. Valida que é da organização do usuário, grava em User.workspaceId
// e atualiza o token (o banco continua sendo a fonte da verdade a cada leitura da sessão).
export async function POST(req: Request) {
  const s = await orgSession()
  if (!s) return unauthorized()
  const body = await parseBody(req, switchSchema)
  if ('error' in body) return body.error
  const { workspaceId } = body.data
  if (!validSpaceId(workspaceId)) return notFound('Espaço')
  try {
    await switchSpace(s.userId, s.organizationId, workspaceId)
  } catch (e) {
    return spaceErrorResponse(e)
  }
  try {
    await unstable_update({ user: { workspaceId } })
  } catch (e) {
    console.error('[spaces/switch] não atualizou o token:', e instanceof Error ? e.message : 'erro')
  }
  return NextResponse.json({ ok: true, workspaceId })
}

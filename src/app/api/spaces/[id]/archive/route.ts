import { NextResponse } from 'next/server'
import { notFound, unauthorized } from '@/server/settings/http'
import { orgSession, spaceErrorResponse, validSpaceId } from '@/server/spaces/http'
import { archiveSpace } from '@/server/spaces/service'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST: arquiva o espaço (só com o WhatsApp desconectado e havendo outro espaço). Não apaga nada.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const s = await orgSession()
  if (!s) return unauthorized()
  if (!validSpaceId(params.id)) return notFound('Espaço')
  try {
    const { proximoId } = await archiveSpace(s.organizationId, params.id)
    return NextResponse.json({ ok: true, proximoId, eraAtivo: params.id === s.workspaceId })
  } catch (e) {
    return spaceErrorResponse(e)
  }
}

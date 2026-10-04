import { NextResponse } from 'next/server'
import { denyUnless } from '@/server/auth/guard'
import { notFound, parseBody, unauthorized } from '@/server/settings/http'
import { orgSession, spaceErrorResponse, validSpaceId } from '@/server/spaces/http'
import { patchSchema, updateSpace } from '@/server/spaces/service'

export const dynamic = 'force-dynamic'

// PATCH { nome?, ordem? }: renomeia (nome do negócio daquele WhatsApp) e/ou reordena. Só espaços da organização.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const deny = await denyUnless('spaces.manage'); if (deny) return deny
  const s = await orgSession()
  if (!s) return unauthorized()
  if (!validSpaceId(params.id)) return notFound('Espaço')
  const body = await parseBody(req, patchSchema)
  if ('error' in body) return body.error
  try {
    await updateSpace(s.organizationId, params.id, body.data)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return spaceErrorResponse(e)
  }
}

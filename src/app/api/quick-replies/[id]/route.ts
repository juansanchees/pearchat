import { NextResponse } from 'next/server'
import { denyUnless } from '@/server/auth/guard'
import { isValidId } from '@/server/messages/api'
import { apiSession, fail, notFound, parseBody, unauthorized } from '@/server/settings/http'
import { deleteQuickReply, QuickReplyError, updateQuickReply, updateSchema } from '@/server/quick-replies/service'

export const dynamic = 'force-dynamic'

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const deny = await denyUnless('quickreplies.manage'); if (deny) return deny
  const s = await apiSession()
  if (!s) return unauthorized()
  if (!isValidId(params.id)) return notFound('Resposta')
  const body = await parseBody(req, updateSchema)
  if ('error' in body) return body.error
  try {
    return NextResponse.json(await updateQuickReply(s.workspaceId, params.id, body.data))
  } catch (e) {
    if (e instanceof QuickReplyError) return fail(e.message, e.status)
    throw e
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const deny = await denyUnless('quickreplies.manage'); if (deny) return deny
  const s = await apiSession()
  if (!s) return unauthorized()
  if (!isValidId(params.id)) return notFound('Resposta')
  try {
    await deleteQuickReply(s.workspaceId, params.id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof QuickReplyError) return fail(e.message, e.status)
    throw e
  }
}

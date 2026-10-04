import { NextResponse } from 'next/server'
import { denyUnless } from '@/server/auth/guard'
import { apiSession, fail, parseBody, unauthorized } from '@/server/settings/http'
import { orderSchema, QuickReplyError, reorderQuickReplies } from '@/server/quick-replies/service'

export const dynamic = 'force-dynamic'

export async function PUT(req: Request) {
  const deny = await denyUnless('quickreplies.manage'); if (deny) return deny
  const s = await apiSession()
  if (!s) return unauthorized()
  const body = await parseBody(req, orderSchema)
  if ('error' in body) return body.error
  try {
    await reorderQuickReplies(s.workspaceId, body.data.ids)
    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof QuickReplyError) return fail(e.message, e.status)
    throw e
  }
}

import { NextResponse } from 'next/server'
import { denyUnless } from '@/server/auth/guard'
import { apiSession, fail, parseBody, unauthorized } from '@/server/settings/http'
import { createQuickReply, createSchema, listQuickReplies, QuickReplyError } from '@/server/quick-replies/service'

export const dynamic = 'force-dynamic'

export async function GET() {
  const deny = await denyUnless('quickreplies.use'); if (deny) return deny
  const s = await apiSession()
  if (!s) return unauthorized()
  return NextResponse.json(await listQuickReplies(s.workspaceId))
}

export async function POST(req: Request) {
  const deny = await denyUnless('quickreplies.manage'); if (deny) return deny
  const s = await apiSession()
  if (!s) return unauthorized()
  const body = await parseBody(req, createSchema)
  if ('error' in body) return body.error
  try {
    return NextResponse.json(await createQuickReply(s.workspaceId, body.data), { status: 201 })
  } catch (e) {
    if (e instanceof QuickReplyError) return fail(e.message, e.status)
    throw e
  }
}

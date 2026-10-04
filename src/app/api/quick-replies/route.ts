import { NextResponse } from 'next/server'
import { apiSession, fail, parseBody, unauthorized } from '@/server/settings/http'
import { createQuickReply, createSchema, listQuickReplies, QuickReplyError } from '@/server/quick-replies/service'

export const dynamic = 'force-dynamic'

export async function GET() {
  const s = await apiSession()
  if (!s) return unauthorized()
  return NextResponse.json(await listQuickReplies(s.workspaceId))
}

export async function POST(req: Request) {
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

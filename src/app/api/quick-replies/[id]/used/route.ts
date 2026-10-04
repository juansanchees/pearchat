import { NextResponse } from 'next/server'
import { isValidId } from '@/server/messages/api'
import { apiSession, fail, notFound, unauthorized } from '@/server/settings/http'
import { markQuickReplyUsed, QuickReplyError } from '@/server/quick-replies/service'

export const dynamic = 'force-dynamic'

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const s = await apiSession()
  if (!s) return unauthorized()
  if (!isValidId(params.id)) return notFound('Resposta')
  try {
    await markQuickReplyUsed(s.workspaceId, params.id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof QuickReplyError) return fail(e.message, e.status)
    throw e
  }
}

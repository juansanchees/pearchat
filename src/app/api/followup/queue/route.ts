import { NextResponse } from 'next/server'
import { denyUnless } from '@/server/auth/guard'
import { getFollowUpQueue } from '@/server/followup/service'
import { apiSession, unauthorized } from '@/server/settings/http'

export const dynamic = 'force-dynamic'

export async function GET() {
  const deny = await denyUnless('followup.manage'); if (deny) return deny
  const s = await apiSession()
  if (!s) return unauthorized()
  return NextResponse.json(await getFollowUpQueue(s.workspaceId))
}

import { NextResponse } from 'next/server'
import { denyUnless } from '@/server/auth/guard'
import { getListsWithCounts } from '@/server/campaigns/recipients'
import { apiSession, unauthorized } from '@/server/settings/http'

export const dynamic = 'force-dynamic'

export async function GET() {
  const deny = await denyUnless('campaigns.manage'); if (deny) return deny
  const s = await apiSession()
  if (!s) return unauthorized()
  return NextResponse.json(await getListsWithCounts(s.workspaceId))
}

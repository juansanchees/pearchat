import { NextResponse } from 'next/server'
import { getListsWithCounts } from '@/server/campaigns/recipients'
import { apiSession, unauthorized } from '@/server/settings/http'

export const dynamic = 'force-dynamic'

export async function GET() {
  const s = await apiSession()
  if (!s) return unauthorized()
  return NextResponse.json(await getListsWithCounts(s.workspaceId))
}

import { NextResponse } from 'next/server'
import { teamActor } from '@/server/team/http'
import { recentActivity } from '@/server/team/service'

export const dynamic = 'force-dynamic'

// GET: últimas 20 atividades da organização (auditoria mínima). Só o dono.
export async function GET() {
  const a = await teamActor('team.audit')
  if (a instanceof NextResponse) return a
  return NextResponse.json(await recentActivity(a.organizationId, 20))
}

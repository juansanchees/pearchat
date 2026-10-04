import { NextResponse } from 'next/server'
import { teamActor, teamErrorResponse } from '@/server/team/http'
import { listTeam } from '@/server/team/service'

export const dynamic = 'force-dynamic'

// GET: pessoas da organização + convites pendentes + limite do plano. Dono e administrador.
export async function GET() {
  const a = await teamActor('team.manage')
  if (a instanceof NextResponse) return a
  try {
    return NextResponse.json(await listTeam(a))
  } catch (e) {
    return teamErrorResponse(e)
  }
}

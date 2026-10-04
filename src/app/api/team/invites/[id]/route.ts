import { NextResponse } from 'next/server'
import { teamActor, teamErrorResponse, teamNotFound, validTeamId } from '@/server/team/http'
import { revokeInvite } from '@/server/team/service'

export const dynamic = 'force-dynamic'

// DELETE: revoga o convite (o link deixa de funcionar).
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const a = await teamActor('team.manage')
  if (a instanceof NextResponse) return a
  if (!validTeamId(params.id)) return teamNotFound()
  try {
    await revokeInvite(a, params.id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return teamErrorResponse(e)
  }
}

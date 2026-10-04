import { NextResponse } from 'next/server'
import { parseBody } from '@/server/settings/http'
import { memberPatchSchema, teamActor, teamErrorResponse, teamNotFound, validTeamId } from '@/server/team/http'
import { removeMember, updateMember } from '@/server/team/service'

export const dynamic = 'force-dynamic'

// PATCH { papel?, workspaceIds? }: muda o papel e/ou os WhatsApps liberados. Administrador não mexe no dono; ninguém
// sobe o próprio papel; a conta nunca fica sem dono.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const a = await teamActor('team.manage')
  if (a instanceof NextResponse) return a
  if (!validTeamId(params.id)) return teamNotFound()
  const body = await parseBody(req, memberPatchSchema)
  if ('error' in body) return body.error
  try {
    await updateMember(a, params.id, body.data)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return teamErrorResponse(e)
  }
}

// DELETE: remove da equipe (desativa o acesso, derruba sessões e sockets, tira as conversas do "responsável").
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const a = await teamActor('team.manage')
  if (a instanceof NextResponse) return a
  if (!validTeamId(params.id)) return teamNotFound()
  try {
    await removeMember(a, params.id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return teamErrorResponse(e)
  }
}

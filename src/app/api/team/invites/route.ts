import { NextResponse } from 'next/server'
import { parseBody } from '@/server/settings/http'
import { inviteSchema, teamActor, teamErrorResponse } from '@/server/team/http'
import { createInvite } from '@/server/team/service'

export const dynamic = 'force-dynamic'

// POST { email, papel: admin|agent, workspaceIds }: cria o convite (7 dias). Responde também com o link, para o dono
// copiar quando o serviço de e-mail não está configurado. 403 LIMITE_PLANO quando o plano não comporta mais pessoas.
export async function POST(req: Request) {
  const a = await teamActor('team.manage')
  if (a instanceof NextResponse) return a
  const body = await parseBody(req, inviteSchema)
  if ('error' in body) return body.error
  try {
    return NextResponse.json(await createInvite(a, body.data), { status: 201 })
  } catch (e) {
    return teamErrorResponse(e)
  }
}

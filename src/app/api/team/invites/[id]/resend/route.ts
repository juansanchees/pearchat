import { NextResponse } from 'next/server'
import { readJson } from '@/server/http/body'
import { resendSchema, teamActor, teamErrorResponse, teamNotFound, validTeamId } from '@/server/team/http'
import { resendInvite } from '@/server/team/service'

export const dynamic = 'force-dynamic'

// POST { enviarEmail? }: gera um link NOVO (o anterior deixa de valer) e renova a validade. `enviarEmail: false` só
// devolve o link para copiar ("Copiar link" na tela de Equipe).
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const a = await teamActor('team.manage')
  if (a instanceof NextResponse) return a
  if (!validTeamId(params.id)) return teamNotFound()
  const parsed = resendSchema.safeParse((await readJson(req)) ?? undefined)
  try {
    return NextResponse.json(await resendInvite(a, params.id, { enviarEmail: parsed.success ? parsed.data.enviarEmail !== false : true }))
  } catch (e) {
    return teamErrorResponse(e)
  }
}

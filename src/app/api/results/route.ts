import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { badRequest, sessionWorkspaceId, unauthorized } from '@/server/messages/api'
import { getResults } from '@/server/results/service'
import type { Periodo } from '@/server/results/types'

export const dynamic = 'force-dynamic'

const querySchema = z.object({ period: z.enum(['7', '30', '90']).default('30') })

/** GET /api/results?period=7|30|90 -> ResultsDto (sessão; só o espaço ativo; cache de 60 s no servidor). */
export async function GET(req: NextRequest) {
  const workspaceId = await sessionWorkspaceId()
  if (!workspaceId) return unauthorized()
  const parsed = querySchema.safeParse({ period: req.nextUrl.searchParams.get('period') ?? undefined })
  if (!parsed.success) return badRequest('Período inválido: use 7, 30 ou 90')
  const result = await getResults(workspaceId, Number(parsed.data.period) as Periodo)
  if (!result) return NextResponse.json({ error: 'Espaço indisponível' }, { status: 404 })
  return NextResponse.json(result)
}

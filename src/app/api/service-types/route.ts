import { NextResponse } from 'next/server'
import { denyUnless } from '@/server/auth/guard'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import { badRequest, readJson, sessionWorkspaceId, unauthorized } from '@/server/messages/api'
import { apiError } from '@/server/calendar/service'
import {
  COR_RE,
  MSG_NOME_REPETIDO,
  duracaoSchema,
  ensureServiceTypes,
  listActiveServiceTypes,
  toServiceTypeDto,
} from '@/server/calendar/service-types'
import type { ServiceTypeListResponse } from '@/server/calendar/types'

export const dynamic = 'force-dynamic'

/** GET /api/service-types -> tipos ativos ordenados. Workspaces sem nenhum tipo ganham os padrões genéricos. */
export async function GET() {
  const workspaceId = await sessionWorkspaceId()
  if (!workspaceId) return unauthorized()
  await ensureServiceTypes(workspaceId)
  const rows = await listActiveServiceTypes(workspaceId)
  return NextResponse.json({ tipos: rows.map(toServiceTypeDto) } satisfies ServiceTypeListResponse)
}

const postSchema = z
  .object({
    nome: z.string().trim().min(1).max(40),
    duracaoMin: duracaoSchema,
    cor: z.string().regex(COR_RE).nullish(),
  })
  .strict()

/** POST /api/service-types { nome, duracaoMin, cor? } -> 201 { tipo } | 400 | 409 nome repetido. */
export async function POST(req: Request) {
  const deny = await denyUnless('servicetypes.manage'); if (deny) return deny
  const workspaceId = await sessionWorkspaceId()
  if (!workspaceId) return unauthorized()
  const parsed = postSchema.safeParse(await readJson(req))
  if (!parsed.success) return badRequest('Dados do tipo inválidos (nome de 1 a 40 letras, duração de 5 a 480 min)')
  const b = parsed.data

  const dup = await db.serviceType.findFirst({
    where: { workspaceId, nome: { equals: b.nome, mode: 'insensitive' } },
    select: { id: true },
  })
  if (dup) return apiError('NOME_REPETIDO', MSG_NOME_REPETIDO, 409)

  const last = await db.serviceType.aggregate({ where: { workspaceId }, _max: { ordem: true } })
  try {
    const created = await db.serviceType.create({
      data: { workspaceId, nome: b.nome, duracaoMin: b.duracaoMin, cor: b.cor ?? null, ordem: (last._max.ordem ?? -1) + 1 },
    })
    return NextResponse.json({ tipo: toServiceTypeDto(created) }, { status: 201 })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return apiError('NOME_REPETIDO', MSG_NOME_REPETIDO, 409)
    }
    throw e
  }
}

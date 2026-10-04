import { NextResponse } from 'next/server'
import { denyUnless } from '@/server/auth/guard'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import { badRequest, isValidId, readJson, sessionWorkspaceId, unauthorized } from '@/server/messages/api'
import { apiError } from '@/server/calendar/service'
import { COR_RE, MSG_NOME_REPETIDO, duracaoSchema, toServiceTypeDto } from '@/server/calendar/service-types'
import { MSG_ULTIMO_TIPO } from '@/server/calendar/types'

export const dynamic = 'force-dynamic'

interface Ctx {
  params: { id: string }
}

const notFound = () => apiError('NAO_ENCONTRADO', 'Tipo de atendimento não encontrado.', 404)

const patchSchema = z
  .object({
    nome: z.string().trim().min(1).max(40).optional(),
    duracaoMin: duracaoSchema.optional(),
    cor: z.string().regex(COR_RE).nullable().optional(),
    ativo: z.boolean().optional(),
  })
  .strict()

/** PATCH /api/service-types/[id] -> 200 { tipo } | 400 | 404 | 409. Não permite desativar o último tipo ativo. */
export async function PATCH(req: Request, { params }: Ctx) {
  const deny = await denyUnless('servicetypes.manage'); if (deny) return deny
  const workspaceId = await sessionWorkspaceId()
  if (!workspaceId) return unauthorized()
  if (!isValidId(params.id)) return notFound()
  const parsed = patchSchema.safeParse(await readJson(req))
  if (!parsed.success) return badRequest('Dados do tipo inválidos (nome de 1 a 40 letras, duração de 5 a 480 min)')
  const b = parsed.data

  const current = await db.serviceType.findFirst({ where: { id: params.id, workspaceId } })
  if (!current) return notFound()

  if (b.ativo === false && current.ativo) {
    const outros = await db.serviceType.count({ where: { workspaceId, ativo: true, id: { not: current.id } } })
    if (outros === 0) return apiError('ULTIMO_TIPO', MSG_ULTIMO_TIPO, 400)
  }
  if (b.nome !== undefined) {
    const dup = await db.serviceType.findFirst({
      where: { workspaceId, id: { not: current.id }, nome: { equals: b.nome, mode: 'insensitive' } },
      select: { id: true },
    })
    if (dup) return apiError('NOME_REPETIDO', MSG_NOME_REPETIDO, 409)
  }

  try {
    const updated = await db.serviceType.update({
      where: { id: current.id },
      data: {
        ...(b.nome !== undefined ? { nome: b.nome } : {}),
        ...(b.duracaoMin !== undefined ? { duracaoMin: b.duracaoMin } : {}),
        ...(b.cor !== undefined ? { cor: b.cor } : {}),
        ...(b.ativo !== undefined ? { ativo: b.ativo } : {}),
      },
    })
    return NextResponse.json({ tipo: toServiceTypeDto(updated) })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return apiError('NOME_REPETIDO', MSG_NOME_REPETIDO, 409)
    }
    throw e
  }
}

/** DELETE /api/service-types/[id] -> 200 { ok } | 400 (último tipo) | 404. Eventos antigos mantêm o texto `tipo`. */
export async function DELETE(_req: Request, { params }: Ctx) {
  const deny = await denyUnless('servicetypes.manage'); if (deny) return deny
  const workspaceId = await sessionWorkspaceId()
  if (!workspaceId) return unauthorized()
  if (!isValidId(params.id)) return notFound()
  const current = await db.serviceType.findFirst({ where: { id: params.id, workspaceId } })
  if (!current) return notFound()
  if (current.ativo) {
    const outros = await db.serviceType.count({ where: { workspaceId, ativo: true, id: { not: current.id } } })
    if (outros === 0) return apiError('ULTIMO_TIPO', MSG_ULTIMO_TIPO, 400)
  }
  await db.serviceType.delete({ where: { id: current.id } })
  return NextResponse.json({ ok: true })
}

import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import {
  badRequest,
  conflict,
  contactNotFound,
  sessionWorkspaceId,
  unauthorized,
  zodMessage,
} from '@/server/contacts/api'
import { patchSchema } from '@/server/contacts/schemas'
import type { PatchInput } from '@/server/contacts/schemas'
import { contactInclude, toContactDTO } from '@/server/contacts/serialize'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } }

function toUpdate(p: PatchInput): Prisma.ContactUpdateInput {
  const data: Prisma.ContactUpdateInput = {}
  if (p.name !== undefined) data.nome = p.name
  if (p.email !== undefined) data.email = p.email
  if (p.tags !== undefined) data.tags = p.tags
  if (p.address !== undefined) data.endereco = p.address
  if (p.birthday !== undefined) data.aniversario = p.birthday
  if (p.notes !== undefined) data.notas = p.notes
  if (p.optOut !== undefined) data.optOut = p.optOut
  return data
}

export async function GET(_req: Request, { params }: Ctx) {
  const workspaceId = await sessionWorkspaceId()
  if (!workspaceId) return unauthorized()

  const row = await db.contact.findFirst({ where: { id: params.id, workspaceId }, include: contactInclude })
  return row ? NextResponse.json(toContactDTO(row)) : contactNotFound()
}

export async function PATCH(req: Request, { params }: Ctx) {
  const workspaceId = await sessionWorkspaceId()
  if (!workspaceId) return unauthorized()

  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return badRequest(zodMessage(parsed.error))

  const { count } = await db.contact.updateMany({
    where: { id: params.id, workspaceId },
    data: toUpdate(parsed.data) as Prisma.ContactUpdateManyMutationInput,
  })
  if (count === 0) return contactNotFound()

  const row = await db.contact.findFirst({ where: { id: params.id, workspaceId }, include: contactInclude })
  return row ? NextResponse.json(toContactDTO(row)) : contactNotFound()
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const workspaceId = await sessionWorkspaceId()
  if (!workspaceId) return unauthorized()

  const row = await db.contact.findFirst({
    where: { id: params.id, workspaceId },
    select: { id: true, conversation: { select: { id: true } } },
  })
  if (!row) return contactNotFound()
  if (row.conversation) return conflict('Este contato tem uma conversa e não pode ser excluído')

  await db.contact.deleteMany({ where: { id: row.id, workspaceId } })
  return NextResponse.json({ ok: true })
}

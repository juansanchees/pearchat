import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  badRequest,
  conflict,
  DUPLICATE_PHONE_MESSAGE,
  isUniqueViolation,
  readJson,
  sessionWorkspaceId,
  unauthorized,
  zodMessage,
} from '@/server/contacts/api'
import { phoneCandidates } from '@/server/contacts/phone'
import { listContacts } from '@/server/contacts/queries'
import { createSchema, listQuerySchema } from '@/server/contacts/schemas'
import { contactInclude, toContactDTO } from '@/server/contacts/serialize'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const workspaceId = await sessionWorkspaceId()
  if (!workspaceId) return unauthorized()

  const sp = req.nextUrl.searchParams
  const parsed = listQuerySchema.safeParse({
    q: sp.get('q') ?? undefined,
    tag: sp.get('tag') ?? undefined,
    cursor: sp.get('cursor') ?? undefined,
    take: sp.get('take') ?? undefined,
  })
  if (!parsed.success) return badRequest(zodMessage(parsed.error))

  try {
    return NextResponse.json(await listContacts(workspaceId, parsed.data))
  } catch (e) {
    if (!parsed.data.cursor) throw e
    return badRequest('Cursor inválido') // inexistente ou de outro workspace
  }
}

export async function POST(req: Request) {
  const workspaceId = await sessionWorkspaceId()
  if (!workspaceId) return unauthorized()

  const body = await readJson(req)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) return badRequest(zodMessage(parsed.error))
  const { name, phone, email, tags, address, birthday, notes } = parsed.data

  // Mesmo número em outro formato (com/sem +55, com/sem o 9º dígito) também é duplicado.
  const same = await db.contact.findFirst({
    where: { workspaceId, telefone: { in: phoneCandidates(phone) } },
    select: { id: true },
  })
  if (same) return conflict(DUPLICATE_PHONE_MESSAGE)

  try {
    const created = await db.contact.create({
      data: {
        workspaceId,
        nome: name,
        telefone: phone,
        email: email ?? null,
        tags: tags ?? [],
        endereco: address ?? null,
        aniversario: birthday ?? null,
        notas: notes ?? null,
        clienteDesde: tags?.includes('Cliente') ? new Date() : null,
      },
      include: contactInclude,
    })
    return NextResponse.json(toContactDTO(created), { status: 201 })
  } catch (e) {
    if (isUniqueViolation(e)) return conflict(DUPLICATE_PHONE_MESSAGE)
    throw e
  }
}

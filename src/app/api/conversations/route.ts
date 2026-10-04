import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import { escapeLike } from '@/server/contacts/queries'
import { badRequest, cleanText, isValidId, sessionIds, unauthorized } from '@/server/messages/api'
import { conversationInclude, toConversationItem } from '@/server/messages/dto'

export const dynamic = 'force-dynamic'

const querySchema = z.object({
  filter: z.enum(['todas', 'nao_lidas', 'com_ia', 'minhas']).default('todas'),
  // Uma conversa específica (ex.: aberta por ?c= e fora das 200 da lista).
  id: z.string().max(64).refine(isValidId, 'Id inválido').optional(),
  q: z
    .string()
    .max(300)
    .transform((v) => cleanText(v).trim().slice(0, 100))
    .default(''),
})

export async function GET(req: NextRequest) {
  const ids = await sessionIds()
  if (!ids) return unauthorized()
  const { workspaceId, userId } = ids

  const sp = req.nextUrl.searchParams
  const parsed = querySchema.safeParse({
    filter: sp.get('filter') ?? undefined,
    q: sp.get('q') ?? undefined,
    id: sp.get('id') ?? undefined,
  })
  if (!parsed.success) return badRequest('Parâmetros inválidos')
  const { filter, q, id } = parsed.data

  const where: Prisma.ConversationWhereInput = { workspaceId }
  if (id) where.id = id
  if (filter === 'nao_lidas') where.unread = { gt: 0 }
  if (filter === 'com_ia') where.mode = 'IA'
  if (filter === 'minhas') where.assigneeId = userId // Equipe: conversas atribuídas a mim
  if (q) {
    // Nome ou telefone (qualquer máscara). A busca é no servidor: acha também conversas além das 200 da lista.
    const digits = q.replace(/\D/g, '')
    const or: Prisma.ContactWhereInput[] = []
    if (/[\\%_]/.test(q)) {
      // `contains` do Prisma trata % e _ como coringa; com eles digitados o nome vai por SQL parametrizado literal.
      const like = `%${escapeLike(q)}%`
      const named = await db.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT c."id" FROM "Contact" c WHERE c."workspaceId" = ${workspaceId} AND c."nome" ILIKE ${like} LIMIT 500`,
      )
      if (named.length) or.push({ id: { in: named.map((r) => r.id) } })
    } else {
      or.push({ nome: { contains: q, mode: 'insensitive' } })
    }
    if (digits.length >= 3 && /^[\d\s()+-]+$/.test(q)) or.push({ telefone: { contains: digits } })
    where.contact = or.length ? { OR: or } : { id: { in: [] } }
  }

  const rows = await db.conversation.findMany({
    where,
    include: conversationInclude,
    orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
    take: 200,
  })
  return NextResponse.json(rows.map(toConversationItem))
}

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import { badRequest, sessionWorkspaceId, unauthorized } from '@/server/messages/api'
import { conversationInclude, toConversationItem } from '@/server/messages/dto'

export const dynamic = 'force-dynamic'

const querySchema = z.object({
  filter: z.enum(['todas', 'nao_lidas', 'com_ia']).default('todas'),
  q: z.string().trim().max(100).default(''),
})

export async function GET(req: NextRequest) {
  const workspaceId = await sessionWorkspaceId()
  if (!workspaceId) return unauthorized()

  const sp = req.nextUrl.searchParams
  const parsed = querySchema.safeParse({
    filter: sp.get('filter') ?? undefined,
    q: sp.get('q') ?? undefined,
  })
  if (!parsed.success) return badRequest('Parâmetros inválidos')
  const { filter, q } = parsed.data

  const where: Prisma.ConversationWhereInput = { workspaceId }
  if (filter === 'nao_lidas') where.unread = { gt: 0 }
  if (filter === 'com_ia') where.mode = 'IA'
  if (q) where.contact = { nome: { contains: q, mode: 'insensitive' } }

  const rows = await db.conversation.findMany({
    where,
    include: conversationInclude,
    orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
    take: 200,
  })
  return NextResponse.json(rows.map(toConversationItem))
}

import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { onlyDigits } from '@/server/whatsapp/phone'
import { contactInclude, toContactDTO } from './serialize'
import { FILTER_TAGS, tagVariants } from './tags'
import type { FilterTag } from './tags'
import type { ContactCounts, ContactListResponse } from './types'

const PHONE_LIKE = /^[\d\s()+-]+$/

const orderBy: Prisma.ContactOrderByWithRelationInput[] = [
  { conversation: { lastMessageAt: { sort: 'desc', nulls: 'last' } } },
  { createdAt: 'desc' },
  { nome: 'asc' },
  { id: 'asc' },
]

const tagFilter = (tag: FilterTag): Prisma.ContactWhereInput => ({
  tags: { hasSome: tagVariants(FILTER_TAGS[tag]) },
})

/** ids de contatos do workspace com alguma etiqueta contendo `q` (sem diferenciar caixa). */
async function idsByTagText(workspaceId: string, q: string): Promise<string[]> {
  const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`
  const rows = await db.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT c."id" FROM "Contact" c WHERE c."workspaceId" = ${workspaceId}
      AND EXISTS (SELECT 1 FROM unnest(c."tags") t WHERE t ILIKE ${like})`,
  )
  return rows.map((r) => r.id)
}

async function searchFilter(workspaceId: string, q: string): Promise<Prisma.ContactWhereInput | null> {
  if (!q) return null
  const or: Prisma.ContactWhereInput[] = [{ nome: { contains: q, mode: 'insensitive' } }]
  const digits = onlyDigits(q)
  if (digits && PHONE_LIKE.test(q)) or.push({ telefone: { contains: digits } })
  const tagIds = await idsByTagText(workspaceId, q)
  if (tagIds.length) or.push({ id: { in: tagIds } })
  return { OR: or }
}

async function countByFilter(workspaceId: string): Promise<ContactCounts> {
  const [todos, clientes, leads, vip] = await Promise.all([
    db.contact.count({ where: { workspaceId } }),
    db.contact.count({ where: { workspaceId, ...tagFilter('cliente') } }),
    db.contact.count({ where: { workspaceId, ...tagFilter('lead') } }),
    db.contact.count({ where: { workspaceId, ...tagFilter('vip') } }),
  ])
  return { todos, clientes, leads, vip }
}

export type ListParams = { q: string; tag: FilterTag | null; cursor?: string; take: number }

export async function listContacts(workspaceId: string, p: ListParams): Promise<ContactListResponse> {
  const and: Prisma.ContactWhereInput[] = []
  if (p.tag) and.push(tagFilter(p.tag))
  const search = await searchFilter(workspaceId, p.q)
  if (search) and.push(search)
  const where: Prisma.ContactWhereInput = { workspaceId, AND: and }

  const [rows, total, counts] = await Promise.all([
    db.contact.findMany({
      where,
      include: contactInclude,
      orderBy,
      take: p.take + 1,
      ...(p.cursor ? { cursor: { id: p.cursor }, skip: 1 } : {}),
    }),
    db.contact.count({ where }),
    countByFilter(workspaceId),
  ])
  const page = rows.slice(0, p.take)
  const nextCursor = rows.length > p.take ? page[page.length - 1].id : null
  return { items: page.map(toContactDTO), nextCursor, total, counts }
}

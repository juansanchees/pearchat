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

/** Escapa a barra, % e _ para usar o texto digitado literalmente num LIKE/ILIKE. */
export const escapeLike = (q: string) => q.replace(/[\\%_]/g, '\\$&')

/**
 * ids de contatos do workspace cujo nome ou alguma etiqueta contém `q` (sem diferenciar caixa).
 * SQL parametrizado; `%` e `_` digitados valem como texto (o `contains` do Prisma os trata como coringa).
 */
async function idsByNameOrTagText(workspaceId: string, q: string, withName: boolean): Promise<string[]> {
  const like = `%${escapeLike(q)}%`
  const nameLike = withName ? Prisma.sql`c."nome" ILIKE ${like} OR` : Prisma.empty
  const rows = await db.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT c."id" FROM "Contact" c WHERE c."workspaceId" = ${workspaceId}
      AND (${nameLike} EXISTS (SELECT 1 FROM unnest(c."tags") t WHERE t ILIKE ${like}))`,
  )
  return rows.map((r) => r.id)
}

async function searchFilter(workspaceId: string, q: string): Promise<Prisma.ContactWhereInput | null> {
  if (!q) return null
  // Sem coringa digitado, o `contains` do Prisma basta para o nome; com \, % ou _ o nome também vai pelo SQL literal.
  const wild = /[\\%_]/.test(q)
  const or: Prisma.ContactWhereInput[] = wild ? [] : [{ nome: { contains: q, mode: 'insensitive' } }]
  const digits = onlyDigits(q)
  if (digits && PHONE_LIKE.test(q)) or.push({ telefone: { contains: digits } })
  const ids = await idsByNameOrTagText(workspaceId, q, wild)
  if (ids.length) or.push({ id: { in: ids } })
  return or.length ? { OR: or } : { id: { in: [] } }
}

/** Contagens dos filtros numa única consulta (uma conexão do pool em vez de quatro). */
async function countByFilter(workspaceId: string): Promise<ContactCounts> {
  const cliente = tagVariants(FILTER_TAGS.cliente)
  const lead = tagVariants(FILTER_TAGS.lead)
  const vip = tagVariants(FILTER_TAGS.vip)
  const [row] = await db.$queryRaw<ContactCounts[]>(
    Prisma.sql`SELECT count(*)::int AS "todos",
        (count(*) FILTER (WHERE c."tags" && ${cliente}::text[]))::int AS "clientes",
        (count(*) FILTER (WHERE c."tags" && ${lead}::text[]))::int AS "leads",
        (count(*) FILTER (WHERE c."tags" && ${vip}::text[]))::int AS "vip"
      FROM "Contact" c WHERE c."workspaceId" = ${workspaceId}`,
  )
  return row ?? { todos: 0, clientes: 0, leads: 0, vip: 0 }
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

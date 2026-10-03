import type { Contact, Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import type { ImportRow } from './import-parse'
import { normalizeTags } from './tags'
import type { ImportResult } from './types'

const UPDATE_CHUNK = 100

/** Campos que mudam ao reimportar; null = nada a alterar. */
export function diffRow(existing: Contact, row: ImportRow): Prisma.ContactUpdateInput | null {
  const data: Prisma.ContactUpdateInput = {}
  if (existing.nome !== row.name) data.nome = row.name
  if (row.email && existing.email !== row.email) data.email = row.email
  const tags = normalizeTags([...existing.tags, ...row.tags])
  if (tags.length !== existing.tags.length || tags.some((t, i) => t !== existing.tags[i])) data.tags = tags
  return Object.keys(data).length ? data : null
}

async function applyUpdates(updates: { id: string; data: Prisma.ContactUpdateInput }[]): Promise<void> {
  for (let i = 0; i < updates.length; i += UPDATE_CHUNK) {
    const chunk = updates.slice(i, i + UPDATE_CHUNK)
    await db.$transaction(chunk.map((u) => db.contact.update({ where: { id: u.id }, data: u.data })))
  }
}

/** Upsert por telefone dentro do workspace. `ignorados` chega com as linhas repetidas do arquivo. */
export async function importRows(
  workspaceId: string,
  rows: ImportRow[],
  base: Pick<ImportResult, 'erros' | 'ignorados'>,
): Promise<ImportResult> {
  const existing = await db.contact.findMany({
    where: { workspaceId, telefone: { in: rows.map((r) => r.phone) } },
  })
  const byPhone = new Map(existing.map((c) => [c.telefone, c]))

  const toCreate: Prisma.ContactCreateManyInput[] = []
  const updates: { id: string; data: Prisma.ContactUpdateInput }[] = []
  let ignorados = base.ignorados

  for (const row of rows) {
    const found = byPhone.get(row.phone)
    if (!found) {
      toCreate.push({ workspaceId, nome: row.name, telefone: row.phone, email: row.email, tags: row.tags })
      continue
    }
    const data = diffRow(found, row)
    if (data) updates.push({ id: found.id, data })
    else ignorados++
  }

  const created = toCreate.length ? await db.contact.createMany({ data: toCreate, skipDuplicates: true }) : { count: 0 }
  await applyUpdates(updates)
  return {
    criados: created.count,
    atualizados: updates.length,
    ignorados: ignorados + (toCreate.length - created.count),
    erros: base.erros,
  }
}

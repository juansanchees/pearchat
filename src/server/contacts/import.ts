import type { Contact, Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import type { ImportRow } from './import-parse'
import { phoneCandidates } from './phone'
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

const BATCH = 500

/** Upsert por telefone dentro do workspace, em lotes de 500 linhas (transações curtas). `ignorados` chega com as linhas repetidas do arquivo. */
export async function importRows(
  workspaceId: string,
  rows: ImportRow[],
  base: Pick<ImportResult, 'erros' | 'ignorados'>,
): Promise<ImportResult> {
  let criados = 0
  let atualizados = 0
  let ignorados = base.ignorados
  const touched = new Set<string>()
  const newPhones = new Set<string>()

  for (let start = 0; start < rows.length; start += BATCH) {
    const batch = rows.slice(start, start + BATCH)
    const candidates = batch.map((r) => phoneCandidates(r.phone))
    const existing = await db.contact.findMany({
      where: { workspaceId, telefone: { in: Array.from(new Set(candidates.flat())) } },
    })
    const byPhone = new Map(existing.map((c) => [c.telefone, c]))
    // Acha o contato pelo número exato ou por uma variante (9º dígito); evita duplicar no reimport.
    const findExisting = (i: number) => {
      const exact = byPhone.get(batch[i].phone)
      if (exact) return exact
      for (const v of candidates[i]) {
        const hit = byPhone.get(v)
        if (hit) return hit
      }
      return undefined
    }

    const toCreate: Prisma.ContactCreateManyInput[] = []
    const updates: { id: string; data: Prisma.ContactUpdateInput }[] = []

    for (let i = 0; i < batch.length; i++) {
      const row = batch[i]
      if (candidates[i].some((v) => newPhones.has(v))) {
        ignorados++ // mesmo número (em qualquer formato) já foi criado nesta importação
        continue
      }
      const found = findExisting(i)
      if (found && touched.has(found.id)) {
        ignorados++ // duas linhas do arquivo apontam para o mesmo contato (ex.: com e sem o 9º dígito)
        continue
      }
      if (found) touched.add(found.id)
      if (!found) {
        candidates[i].forEach((v) => newPhones.add(v))
        toCreate.push({ workspaceId, nome: row.name, telefone: row.phone, email: row.email, tags: row.tags })
        continue
      }
      const data = diffRow(found, row)
      if (data) updates.push({ id: found.id, data })
      else ignorados++
    }

    const created = toCreate.length ? await db.contact.createMany({ data: toCreate, skipDuplicates: true }) : { count: 0 }
    await applyUpdates(updates)
    criados += created.count
    atualizados += updates.length
    ignorados += toCreate.length - created.count
  }
  return { criados, atualizados, ignorados, erros: base.erros }
}

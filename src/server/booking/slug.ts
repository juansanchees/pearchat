import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { generateSlugCandidate } from './slug-rules'

export { RESERVED_SLUGS, SLUG_MAX, SLUG_MIN, generateSlugCandidate, slugify, validateSlug } from './slug-rules'
export type { SlugCheck } from './slug-rules'

const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'

/** Garante um slug único para o workspace (gera a partir do nome na primeira vez). Idempotente. */
export async function ensureSlug(workspaceId: string): Promise<string> {
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { slug: true, nome: true } })
  if (ws.slug) return ws.slug
  for (let n = 1; n <= 200; n++) {
    const candidate = generateSlugCandidate(ws.nome, n)
    const taken = await db.workspace.findUnique({ where: { slug: candidate }, select: { id: true } })
    if (taken) continue
    try {
      // updateMany com slug nulo: se outra requisição gerou antes, não sobrescreve.
      const r = await db.workspace.updateMany({ where: { id: workspaceId, slug: null }, data: { slug: candidate } })
      if (r.count === 0) break
      return candidate
    } catch (e) {
      if (isUniqueViolation(e)) continue
      throw e
    }
  }
  const again = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { slug: true } })
  if (again.slug) return again.slug
  throw new Error('Não foi possível gerar um endereço para o link')
}

/** Troca o slug (já validado). 'EM_USO' se outro negócio já usa. */
export async function changeSlug(workspaceId: string, slug: string): Promise<'ok' | 'EM_USO'> {
  const taken = await db.workspace.findUnique({ where: { slug }, select: { id: true } })
  if (taken && taken.id !== workspaceId) return 'EM_USO'
  try {
    await db.workspace.update({ where: { id: workspaceId }, data: { slug } })
    return 'ok'
  } catch (e) {
    if (isUniqueViolation(e)) return 'EM_USO'
    throw e
  }
}

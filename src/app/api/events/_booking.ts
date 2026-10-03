import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { MAX_EVENT_MS, eventInclude } from '@/server/calendar/service'
import type { EventRow } from '@/server/calendar/service'
import { addMin, overlaps } from '@/server/calendar/time'

type Tx = Prisma.TransactionClient

/**
 * Serializa as gravações da agenda de um workspace (lock consultivo do Postgres, solto no fim da transação).
 * Sem isso, duas requisições simultâneas (cliente + IA, duplo clique) passam juntas pela checagem de conflito
 * e marcam dois compromissos no mesmo horário. Tudo dentro de `fn` deve usar o `tx` recebido.
 */
export function withBookingLock<T>(workspaceId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`agenda:${workspaceId}`}))`
      return fn(tx)
    },
    { maxWait: 15_000, timeout: 20_000 },
  )
}

/** Compromissos que se sobrepõem a [inicio, fim), ignorando `ignoreId` (o próprio, ao remarcar). */
export async function findOverlappingTx(
  tx: Tx,
  workspaceId: string,
  inicio: Date,
  fim: Date,
  ignoreId?: string,
): Promise<EventRow[]> {
  const rows = await tx.event.findMany({
    where: {
      workspaceId,
      inicio: { gte: new Date(inicio.getTime() - MAX_EVENT_MS), lt: fim },
      ...(ignoreId ? { id: { not: ignoreId } } : {}),
    },
    include: eventInclude,
  })
  return rows.filter((r) => overlaps(inicio, fim, r.inicio, addMin(r.inicio, r.duracaoMin)))
}

/** Igual a resolveContactId (nome sem diferenciar caixa reaproveita o contato), mas dentro da transação. */
export async function resolveContactTx(
  tx: Tx,
  workspaceId: string,
  input: { contactId?: string | null; cliente?: string | null },
): Promise<{ ok: true; id: string | null } | { ok: false }> {
  if (input.contactId) {
    const c = await tx.contact.findFirst({ where: { id: input.contactId, workspaceId }, select: { id: true } })
    return c ? { ok: true, id: c.id } : { ok: false }
  }
  const nome = input.cliente?.trim()
  if (!nome) return { ok: true, id: null }
  const existing = await tx.contact.findFirst({
    where: { workspaceId, nome: { equals: nome, mode: 'insensitive' } },
    select: { id: true },
  })
  if (existing) return { ok: true, id: existing.id }
  const created = await tx.contact.create({ data: { workspaceId, nome, tags: [] }, select: { id: true } })
  return { ok: true, id: created.id }
}

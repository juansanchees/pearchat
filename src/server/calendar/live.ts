import type { CalendarConnection } from '@prisma/client'
import { db } from '@/lib/db'
import { listCalendarEvents, needsReconnect } from './google'
import type { GoogleEventRead } from './google'
import { parseCalendarios, logGoogleFailure } from './service'
import type { EventDto, GoogleListStatus } from './types'

// Leitura ao vivo dos eventos das agendas selecionadas do Google, com cache curto em memória por
// workspace (evita bater no Google a cada navegação). Invalidado ao criar/editar/excluir/sincronizar.

const TTL_MS = 45_000
const MAX_KEYS_PER_WORKSPACE = 24
const COR_PADRAO = '#5fa7a0'

interface Entry {
  at: number
  eventos: GoogleEventRead[]
  status: GoogleListStatus
}

const g = globalThis as unknown as { __pearchat_gcache?: Map<string, Map<string, Entry>> }
const cache = (g.__pearchat_gcache ??= new Map<string, Map<string, Entry>>())

export function invalidateGoogleCache(workspaceId: string): void {
  cache.delete(workspaceId)
}

export interface LiveResult {
  eventos: EventDto[]
  status: GoogleListStatus
  sincronizadoEm: string | null
}

/**
 * Eventos do Google no intervalo [from, to) como EventDto somente leitura.
 * `localGoogleIds`: googleEventId dos eventos que o PearChat criou (não duplicar).
 * Nunca lança: falhas viram `status`.
 */
export async function googleEventsInRange(
  workspaceId: string,
  conn: CalendarConnection,
  from: Date,
  to: Date,
  localGoogleIds: Set<string>,
): Promise<LiveResult> {
  const cals = parseCalendarios(conn.calendarios).filter((c) => c.selecionado)
  if (conn.precisaReconectar) return { eventos: [], status: 'reconectar', sincronizadoEm: iso(conn.ultimaSyncEm) }
  if (cals.length === 0) return { eventos: [], status: 'ok', sincronizadoEm: iso(conn.ultimaSyncEm) }

  const key = `${from.getTime()}|${to.getTime()}|${cals.map((c) => c.id).sort().join(',')}`
  const bucket = cache.get(workspaceId)
  const hit = bucket?.get(key)
  let entry: Entry
  let sincronizadoEm = iso(conn.ultimaSyncEm)
  if (hit && Date.now() - hit.at < TTL_MS) {
    entry = hit
  } else {
    const settled = await Promise.allSettled(cals.map((c) => listCalendarEvents(workspaceId, c.id, from, to)))
    const eventos: GoogleEventRead[] = []
    let ok = 0
    let reconnect = false
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        ok++
        eventos.push(...r.value)
      } else {
        if (needsReconnect(r.reason)) reconnect = true
        logGoogleFailure(`events.list(${cals[i].nome})`, r.reason)
      }
    })
    const status: GoogleListStatus = reconnect ? 'reconectar' : ok === 0 ? 'falhou' : 'ok'
    entry = { at: Date.now(), eventos, status }
    if (status === 'ok') {
      const b = bucket ?? new Map<string, Entry>()
      if (b.size >= MAX_KEYS_PER_WORKSPACE) b.delete(b.keys().next().value as string)
      b.set(key, entry)
      cache.set(workspaceId, b)
      const now = new Date()
      sincronizadoEm = now.toISOString()
      await db.calendarConnection.updateMany({ where: { workspaceId }, data: { ultimaSyncEm: now } }).catch(() => undefined)
    }
  }

  const meta = new Map(cals.map((c) => [c.id, c]))
  const eventos: EventDto[] = []
  for (const e of entry.eventos) {
    if (localGoogleIds.has(e.id)) continue
    if (e.fim <= from || e.inicio >= to) continue
    const cal = meta.get(e.calendarId)
    eventos.push({
      id: `g:${e.calendarId}:${e.id}`,
      inicio: e.inicio.toISOString(),
      fim: e.fim.toISOString(),
      duracaoMin: Math.max(1, Math.round((e.fim.getTime() - e.inicio.getTime()) / 60_000)),
      titulo: e.titulo,
      tipo: e.diaInteiro ? 'Dia inteiro' : 'Google Agenda',
      origem: 'GOOGLE',
      contactId: null,
      cliente: null,
      noGoogle: true,
      somenteLeitura: true,
      diaInteiro: e.diaInteiro,
      cor: cal?.cor ?? COR_PADRAO,
      agenda: cal?.nome ?? null,
    })
  }
  return { eventos, status: entry.status, sincronizadoEm }
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null)

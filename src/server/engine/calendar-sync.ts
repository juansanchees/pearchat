import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { googleConfigured, needsReconnect, syncCalendarEvents } from '@/server/calendar/google'
import { invalidateGoogleCache } from '@/server/calendar/live'
import { MIN_MS } from '@/server/calendar/time'
import { log, logError } from './util'

// Sincronização Google -> PearChat dos eventos que o PEARCHAT criou (googleEventId preenchido).
// Movido no Google -> atualiza inicio/duracaoMin; apagado/cancelado -> apaga o local (e lembretes).
// Eventos que nasceram no Google não são importados: são lidos ao vivo em GET /api/events.
// Sem webhooks de push nesta etapa (exigem domínio verificado): polling a cada 2 min por workspace.

export const SYNC_INTERVAL_MS = 2 * MIN_MS
// Não mexe em eventos alterados há pouco no PearChat (a edição local ainda pode estar a caminho do Google).
const RECENT_LOCAL_EDIT_MS = 30_000
// Em listagem completa, só considera "apagado no Google" o que existe há mais que isso.
const MISSING_GRACE_MS = 60_000

export interface SyncStats {
  atualizados: number
  apagados: number
}

function tokensOf(json: Prisma.JsonValue | null): Record<string, string> {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(json)) if (typeof v === 'string') out[k] = v
  return out
}

/** Sincroniza um workspace (sem checar o intervalo). Lança em erro de rede/autorização. */
export async function syncWorkspace(workspaceId: string): Promise<SyncStats> {
  const conn = await db.calendarConnection.findUnique({ where: { workspaceId } })
  const stats: SyncStats = { atualizados: 0, apagados: 0 }
  if (!conn || conn.provider !== 'google' || !conn.tokens || conn.precisaReconectar) return stats

  const syncStart = Date.now()
  const linked = await db.event.findMany({
    where: { workspaceId, googleEventId: { not: null } },
    select: { id: true, googleEventId: true, googleCalendarId: true, inicio: true, duracaoMin: true, updatedAt: true },
  })
  const fallback = conn.destinoId
  const byCal = new Map<string, typeof linked>()
  for (const e of linked) {
    const cal = e.googleCalendarId ?? fallback
    if (!cal) continue
    byCal.set(cal, [...(byCal.get(cal) ?? []), e])
  }

  const tokens = tokensOf(conn.syncTokens)
  let touched = false
  for (const [calendarId, events] of Array.from(byCal.entries())) {
    const byGid = new Map(events.map((e) => [e.googleEventId as string, e]))
    let res
    try {
      res = await syncCalendarEvents(workspaceId, calendarId, tokens[calendarId] ?? null)
    } catch (err) {
      if (needsReconnect(err)) throw err
      logError('calendar-sync', `agenda ${calendarId}: falha`, err)
      continue
    }
    const recentlyEdited = (e: { updatedAt: Date }) => syncStart - e.updatedAt.getTime() < RECENT_LOCAL_EDIT_MS

    for (const ch of res.changes) {
      const local = byGid.get(ch.id)
      if (!local || recentlyEdited(local)) continue
      if (ch.removido) {
        await db.event.deleteMany({ where: { id: local.id, workspaceId } }) // lembretes caem em cascata
        stats.apagados++
        touched = true
      } else if (ch.inicio && ch.fim && !ch.diaInteiro) {
        const dur = Math.max(5, Math.round((ch.fim.getTime() - ch.inicio.getTime()) / MIN_MS))
        if (ch.inicio.getTime() !== local.inicio.getTime() || dur !== local.duracaoMin) {
          await db.$transaction([
            db.event.updateMany({ where: { id: local.id, workspaceId }, data: { inicio: ch.inicio, duracaoMin: dur } }),
            // O horário mudou: lembretes já registrados valem para o horário antigo.
            db.eventReminder.deleteMany({ where: { eventId: local.id } }),
          ])
          stats.atualizados++
          touched = true
        }
      }
    }

    // Listagem completa e terminada: o que o PearChat criou e não aparece mais foi apagado no Google.
    if (res.completa && res.nextSyncToken && res.presentes) {
      for (const local of events) {
        if (res.presentes.has(local.googleEventId as string)) continue
        if (syncStart - local.updatedAt.getTime() < MISSING_GRACE_MS) continue
        await db.event.deleteMany({ where: { id: local.id, workspaceId } })
        stats.apagados++
        touched = true
      }
    }
    if (res.nextSyncToken) tokens[calendarId] = res.nextSyncToken
  }

  await db.calendarConnection.updateMany({
    where: { workspaceId },
    data: { syncTokens: tokens, ultimaSyncEm: new Date() },
  })
  if (touched) invalidateGoogleCache(workspaceId)
  return stats
}

/**
 * Tarefa do agendador: para cada workspace com Google conectado, sincroniza se a última tentativa
 * tem mais de 2 min (a reivindicação é um UPDATE condicional: instâncias não duplicam). Devolve
 * quantos workspaces foram sincronizados.
 */
export async function runCalendarSync(): Promise<number> {
  if (!googleConfigured()) return 0
  const now = new Date()
  const due = await db.calendarConnection.findMany({
    where: {
      provider: 'google',
      tokens: { not: null },
      precisaReconectar: false,
      OR: [{ syncTentadaEm: null }, { syncTentadaEm: { lt: new Date(now.getTime() - SYNC_INTERVAL_MS) } }],
    },
    select: { workspaceId: true },
  })
  let done = 0
  for (const { workspaceId } of due) {
    const claim = await db.calendarConnection.updateMany({
      where: {
        workspaceId,
        OR: [{ syncTentadaEm: null }, { syncTentadaEm: { lt: new Date(now.getTime() - SYNC_INTERVAL_MS) } }],
      },
      data: { syncTentadaEm: new Date() },
    })
    if (claim.count === 0) continue
    try {
      const s = await syncWorkspace(workspaceId)
      done++
      if (s.atualizados || s.apagados) log('calendar-sync', `${workspaceId}: ${s.atualizados} atualizados, ${s.apagados} apagados`)
    } catch (err) {
      // invalid_grant já marcou precisaReconectar em getValidAccessToken.
      logError('calendar-sync', `workspace ${workspaceId}: falha`, err)
    }
  }
  return done
}

import { db } from '@/lib/db'
import { freeBusy } from '@/server/calendar/google'
import { MAX_EVENT_MS, getConnection, isRealConnection, logGoogleFailure, selectedIds } from '@/server/calendar/service'
import { DEFAULT_TZ, addDaysYmd, ymdOf } from '@/lib/timezone'
import {
  DAY_END_HOUR,
  DAY_START_HOUR,
  SLOT_STEP_MIN,
  addMin,
  isValidDateStr,
  overlaps,
  toHM,
  toInstant,
} from '@/server/calendar/time'

// Horários livres da página pública. Mesmas regras de GET /api/events/free (08:00 às 18:00, passo de 30 min,
// eventos locais + ocupação do Google quando há conexão real), mais a antecedência mínima e o limite de dias.
// Tudo no relógio do fuso do NEGÓCIO (Workspace.timezone): o argumento `tz` de cada função.

export type Busy = { start: Date; end: Date }

/** Data de hoje (YYYY-MM-DD) no fuso `tz`. */
export const todayIn = (tz: string = DEFAULT_TZ, now: Date = new Date()): string => ymdOf(now, tz)

/** Soma dias a uma data YYYY-MM-DD (calendário, sem fuso). */
export const addDaysStr = addDaysYmd

/** Dias disponíveis para agendar: hoje até hoje + (diasAFrente - 1). */
export function windowDates(diasAFrente: number, tz: string = DEFAULT_TZ, now: Date = new Date()): string[] {
  const hoje = todayIn(tz, now)
  return Array.from({ length: diasAFrente }, (_, i) => addDaysStr(hoje, i))
}

export function isDateInWindow(date: string, diasAFrente: number, tz: string = DEFAULT_TZ, now: Date = new Date()): boolean {
  if (!isValidDateStr(date)) return false
  const hoje = todayIn(tz, now)
  return date >= hoje && date <= addDaysStr(hoje, diasAFrente - 1)
}

/** Função pura: inícios livres ("HH:MM") de um dia, dado o que está ocupado. */
export function slotsForDay(
  date: string,
  duracaoMin: number,
  busy: Busy[],
  antecedenciaMin: number,
  tz: string = DEFAULT_TZ,
  now: Date = new Date(),
): string[] {
  const earliest = now.getTime() + antecedenciaMin * 60_000
  const horarios: string[] = []
  const lastStart = DAY_END_HOUR * 60 - duracaoMin
  for (let m = DAY_START_HOUR * 60; m <= lastStart; m += SLOT_STEP_MIN) {
    const ini = toInstant(date, `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`, tz)
    if (ini.getTime() < earliest) continue
    const fim = addMin(ini, duracaoMin)
    if (!busy.some((b) => overlaps(ini, fim, b.start, b.end))) horarios.push(toHM(ini, tz))
  }
  return horarios
}

/** Ocupação (eventos locais + Google) entre [from, to). `google` diz se a agenda do Google foi consultada. */
export async function loadBusy(
  workspaceId: string,
  from: Date,
  to: Date,
  /** Remarcação: o próprio compromisso não ocupa o horário (nem a cópia dele no Google). */
  ignoreEventId?: string,
): Promise<{ busy: Busy[]; google: boolean }> {
  // Cancelados liberam o horário.
  const local = await db.event.findMany({
    where: { workspaceId, status: 'ativo', inicio: { gte: new Date(from.getTime() - MAX_EVENT_MS), lt: to } },
    select: { id: true, inicio: true, duracaoMin: true, googleEventId: true },
  })
  const ignored = ignoreEventId ? local.find((e) => e.id === ignoreEventId) : undefined
  const busy: Busy[] = local.filter((e) => e.id !== ignoreEventId).map((e) => ({ start: e.inicio, end: addMin(e.inicio, e.duracaoMin) }))
  let google = false
  const conn = await getConnection(workspaceId)
  if (conn && isRealConnection(conn)) {
    try {
      const gb = await freeBusy(workspaceId, selectedIds(conn), from, to)
      const oIni = ignored?.googleEventId ? ignored.inicio.getTime() : null
      const oFim = ignored ? addMin(ignored.inicio, ignored.duracaoMin).getTime() : null
      busy.push(...gb.filter((b) => !(oIni !== null && b.start.getTime() === oIni && b.end.getTime() === oFim)))
      google = true
    } catch (err) {
      logGoogleFailure('freeBusy (link público)', err)
    }
  }
  return { busy, google }
}

/** Horários livres de cada dia da janela (um único carregamento de ocupação para todo o período). */
export async function slotsForWindow(
  workspaceId: string,
  duracaoMin: number,
  cfg: { antecedenciaMin: number; diasAFrente: number; timezone?: string },
  now: Date = new Date(),
): Promise<Map<string, string[]>> {
  const tz = cfg.timezone ?? DEFAULT_TZ
  const dates = windowDates(cfg.diasAFrente, tz, now)
  const from = toInstant(dates[0], '00:00', tz)
  const to = toInstant(addDaysStr(dates[dates.length - 1], 1), '00:00', tz)
  const { busy } = await loadBusy(workspaceId, from, to)
  return new Map(dates.map((d) => [d, slotsForDay(d, duracaoMin, busy, cfg.antecedenciaMin, tz, now)]))
}

/** Horários livres de um dia (vazio se o dia está fora da janela). */
export async function slotsForOneDay(
  workspaceId: string,
  date: string,
  duracaoMin: number,
  cfg: { antecedenciaMin: number; diasAFrente: number; timezone?: string },
  now: Date = new Date(),
): Promise<string[]> {
  const tz = cfg.timezone ?? DEFAULT_TZ
  if (!isDateInWindow(date, cfg.diasAFrente, tz, now)) return []
  const { busy } = await loadBusy(workspaceId, toInstant(date, '00:00', tz), toInstant(addDaysStr(date, 1), '00:00', tz))
  return slotsForDay(date, duracaoMin, busy, cfg.antecedenciaMin, tz, now)
}

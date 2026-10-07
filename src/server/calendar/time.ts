// Datas da agenda. O fuso é o do ESPAÇO (Workspace.timezone, padrão America/Sao_Paulo): toda conta com fuso vem de
// `@/lib/timezone` (Intl). Cada função recebe o fuso como último argumento; sem ele vale o padrão (Brasília).
import { DEFAULT_TZ, hmOf, tzParts, zonedToInstant } from '@/lib/timezone'

/** Fuso padrão (Brasília). Só para quem não tem espaço à mão (o espaço guarda o seu em Workspace.timezone). */
export const TZ_NAME = DEFAULT_TZ

export const DAY_START_HOUR = 8
export const DAY_END_HOUR = 18
export const SLOT_STEP_MIN = 30
export const MIN_MS = 60_000

/**
 * Chave do mês "YYYY-MM" no relógio de BRASÍLIA. ÚNICA fonte para ler e gravar UsageCounter.mes: o uso e o plano são da
 * CONTA (que soma vários espaços), não de um espaço, então o mês não segue o fuso de cada espaço. O servidor roda em UTC
 * e o mês virava 3 h antes da meia-noite de Brasília.
 */
export function spMonthKey(d: Date = new Date()): string {
  return tzParts(d, DEFAULT_TZ).ymd.slice(0, 7)
}

/** "YYYY-MM-DD" válido (calendário real) ou false. */
export function isValidDateStr(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s)
}

/** Data "YYYY-MM-DD" + "HH:MM" de parede no fuso `tz` -> instante UTC. */
export function toInstant(date: string, hm: string, tz: string = DEFAULT_TZ): Date {
  return zonedToInstant(date, hm, tz)
}

/** "HH:MM" de um instante, no relógio do fuso `tz`. */
export function toHM(d: Date, tz: string = DEFAULT_TZ): string {
  return hmOf(d, tz)
}

/**
 * Aceita ISO com offset/Z ou data pura "YYYY-MM-DD" (meia-noite do fuso `tz`).
 * Retorna null se inválido.
 */
export function parseInstant(s: string, tz: string = DEFAULT_TZ): Date | null {
  if (isValidDateStr(s)) return toInstant(s, '00:00', tz)
  if (!/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/.test(s)) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

export const addMin = (d: Date, min: number): Date => new Date(d.getTime() + min * MIN_MS)

/** Intervalos [aIni,aFim) e [bIni,bFim) se sobrepõem. */
export function overlaps(aIni: Date, aFim: Date, bIni: Date, bFim: Date): boolean {
  return aIni < bFim && aFim > bIni
}

// Fuso America/Sao_Paulo: UTC-3 fixo (o Brasil não tem horário de verão desde 2019).
// Usamos offset fixo "-03:00" em vez de Intl para ficar determinístico e barato.

export const TZ_NAME = 'America/Sao_Paulo'
const OFFSET = '-03:00'
const OFFSET_MS = 3 * 60 * 60 * 1000

export const DAY_START_HOUR = 8
export const DAY_END_HOUR = 18
export const SLOT_STEP_MIN = 30
export const MIN_MS = 60_000

/** "YYYY-MM-DD" válido (calendário real) ou false. */
export function isValidDateStr(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s)
}

/** Data "YYYY-MM-DD" + "HH:MM" em horário de São Paulo -> instante UTC. */
export function spToDate(date: string, hm: string): Date {
  return new Date(`${date}T${hm}:00${OFFSET}`)
}

/** "HH:MM" de um instante, em horário de São Paulo. */
export function toSpHM(d: Date): string {
  const s = new Date(d.getTime() - OFFSET_MS)
  return `${String(s.getUTCHours()).padStart(2, '0')}:${String(s.getUTCMinutes()).padStart(2, '0')}`
}

/**
 * Aceita ISO com offset/Z ou data pura "YYYY-MM-DD" (meia-noite de São Paulo).
 * Retorna null se inválido.
 */
export function parseInstant(s: string): Date | null {
  if (isValidDateStr(s)) return spToDate(s, '00:00')
  if (!/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/.test(s)) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

export const addMin = (d: Date, min: number): Date => new Date(d.getTime() + min * MIN_MS)

/** Intervalos [aIni,aFim) e [bIni,bFim) se sobrepõem. */
export function overlaps(aIni: Date, aFim: Date, bIni: Date, bFim: Date): boolean {
  return aIni < bFim && aFim > bIni
}

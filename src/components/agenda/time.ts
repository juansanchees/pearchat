// Datas da Agenda no fuso America/Sao_Paulo (UTC-3 fixo, sem horário de verão desde 2019).
// Datas "de calendário" circulam como strings "YYYY-MM-DD"; a aritmética usa Date.UTC.

const SP_OFFSET_MS = 3 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

export const GRID_START_HOUR = 8
export const GRID_HOURS = ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00']
/** A última linha (18:00) cobre até 19:00. */
export const GRID_END_HOUR = 19
export const HOUR_PX = 52

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const DIAS_LONGOS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const pad = (n: number) => String(n).padStart(2, '0')

function parts(date: string) {
  const [y, m, d] = date.split('-').map(Number)
  const utc = Date.UTC(y, m - 1, d)
  return { y, m, d, dow: new Date(utc).getUTCDay(), utc }
}

/** Data de hoje em São Paulo. Só chamar no cliente (depois de montar). */
export function spToday(): string {
  return new Date(Date.now() - SP_OFFSET_MS).toISOString().slice(0, 10)
}

export function addDays(date: string, n: number): string {
  return new Date(parts(date).utc + n * DAY_MS).toISOString().slice(0, 10)
}

/** Dias de `a` até `b` (datas "YYYY-MM-DD"); negativo se `b` é anterior. */
export function diffDays(a: string, b: string): number {
  return Math.round((parts(b).utc - parts(a).utc) / DAY_MS)
}

/** "2026-10-02" + "09:30" -> "2026-10-02T09:30:00-03:00" (aceito pelo back-end). */
export function spInstant(date: string, hm: string): string {
  return `${date}T${hm}:00-03:00`
}

/** Instante ISO (UTC) -> data, hora "HH:MM" e hora decimal em São Paulo. */
export function toSp(iso: string): { date: string; hm: string; hours: number } {
  const d = new Date(new Date(iso).getTime() - SP_OFFSET_MS)
  const h = d.getUTCHours()
  const min = d.getUTCMinutes()
  return { date: d.toISOString().slice(0, 10), hm: `${pad(h)}:${pad(min)}`, hours: h + min / 60 }
}

/** Rótulo do cabeçalho da coluna ("Sex"; a caixa alta vem do CSS). */
export function semLabel(date: string): string {
  return cap(DIAS_CURTOS[parts(date).dow])
}

export function dayNumber(date: string): number {
  return parts(date).d
}

/** "Hoje · sexta, 2 de outubro" ou "Sábado, 3 de outubro". */
export function longLabel(date: string, today: string): string {
  const p = parts(date)
  const base = `${DIAS_LONGOS[p.dow]}, ${p.d} de ${MESES[p.m - 1]}`
  return date === today ? `Hoje · ${base}` : cap(base)
}

/** "hoje" ou "sáb, 3/10". */
export function shortLabel(date: string, today: string): string {
  if (date === today) return 'hoje'
  const p = parts(date)
  return `${DIAS_CURTOS[p.dow]}, ${p.d}/${p.m}`
}

/** Título do cabeçalho da grade: "Outubro 2026" (ou "Setembro – Outubro 2026" quando a semana cruza meses). */
export function weekTitle(start: string): string {
  const a = parts(start)
  const b = parts(addDays(start, 6))
  if (a.m === b.m) return `${cap(MESES[a.m - 1])} ${a.y}`
  if (a.y === b.y) return `${cap(MESES[a.m - 1])} – ${cap(MESES[b.m - 1])} ${a.y}`
  return `${cap(MESES[a.m - 1])} ${a.y} – ${cap(MESES[b.m - 1])} ${b.y}`
}

/** "2 a 8 de outubro" / "28 de setembro a 4 de outubro" / com ano quando cruza o ano. */
export function weekRange(start: string): string {
  const a = parts(start)
  const b = parts(addDays(start, 6))
  if (a.m === b.m) return `${a.d} a ${b.d} de ${MESES[b.m - 1]}`
  if (a.y === b.y) return `${a.d} de ${MESES[a.m - 1]} a ${b.d} de ${MESES[b.m - 1]}`
  return `${a.d} de ${MESES[a.m - 1]} de ${a.y} a ${b.d} de ${MESES[b.m - 1]} de ${b.y}`
}

/** 30 -> "30 min", 60 -> "1 h", 120 -> "2 h", 90 -> "1 h 30 min". */
export function durLabel(min: number): string {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const r = min % 60
  return r ? `${h} h ${r} min` : `${h} h`
}

/** "agora há pouco" / "há 5 min" / "há 2 h" / "há 3 d" a partir de um instante ISO. */
export function agoLabel(iso: string | null, now = Date.now()): string {
  if (!iso) return 'agora há pouco'
  const min = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000))
  if (min < 1) return 'agora há pouco'
  if (min < 60) return `há ${min} min`
  if (min < 24 * 60) return `há ${Math.floor(min / 60)} h`
  return `há ${Math.floor(min / (24 * 60))} d`
}

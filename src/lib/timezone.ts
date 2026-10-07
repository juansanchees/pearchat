// Fuso horário por espaço (WhatsApp). ÚNICO módulo de datas com fuso: servidor, motor e navegador usam as funções daqui
// (Intl com `timeZone`; nada de offset fixo, nada de moment/luxon). Horários gravados no banco são instantes UTC:
// mudar o fuso de um espaço NÃO altera nenhum horário já gravado, só como ele é exibido e como os cálculos futuros
// (silêncio, lembretes, horário de atendimento, dia "de hoje") enxergam o relógio do negócio.

export const DEFAULT_TZ = 'America/Sao_Paulo'

/** Lista fechada de fusos oferecidos (Américas e Europa). `id` = nome IANA. */
export const TIMEZONE_OPTIONS: { id: string; label: string }[] = [
  { id: 'America/Sao_Paulo', label: 'Brasília (São Paulo, Rio de Janeiro)' },
  { id: 'America/Manaus', label: 'Manaus (Amazonas)' },
  { id: 'America/Rio_Branco', label: 'Rio Branco (Acre)' },
  { id: 'America/Noronha', label: 'Fernando de Noronha' },
  { id: 'America/Mexico_City', label: 'Cidade do México (Centro)' },
  { id: 'America/Cancun', label: 'Cancún (Quintana Roo)' },
  { id: 'America/Hermosillo', label: 'Hermosillo (Sonora)' },
  { id: 'America/Tijuana', label: 'Tijuana (Pacífico)' },
  { id: 'America/Argentina/Buenos_Aires', label: 'Buenos Aires (Argentina)' },
  { id: 'America/Santiago', label: 'Santiago (Chile)' },
  { id: 'America/Bogota', label: 'Bogotá (Colômbia)' },
  { id: 'America/Lima', label: 'Lima (Peru)' },
  { id: 'America/Guayaquil', label: 'Guayaquil (Equador)' },
  { id: 'America/Caracas', label: 'Caracas (Venezuela)' },
  { id: 'America/La_Paz', label: 'La Paz (Bolívia)' },
  { id: 'America/Asuncion', label: 'Assunção (Paraguai)' },
  { id: 'America/Montevideo', label: 'Montevidéu (Uruguai)' },
  { id: 'America/Panama', label: 'Panamá' },
  { id: 'America/Costa_Rica', label: 'Costa Rica' },
  { id: 'America/Guatemala', label: 'Guatemala' },
  { id: 'America/New_York', label: 'Nova York (EUA, Leste)' },
  { id: 'America/Chicago', label: 'Chicago (EUA, Centro)' },
  { id: 'America/Denver', label: 'Denver (EUA, Montanhas)' },
  { id: 'America/Phoenix', label: 'Phoenix (Arizona)' },
  { id: 'America/Los_Angeles', label: 'Los Angeles (EUA, Pacífico)' },
  { id: 'America/Toronto', label: 'Toronto (Canadá, Leste)' },
  { id: 'America/Vancouver', label: 'Vancouver (Canadá, Pacífico)' },
  { id: 'Europe/Lisbon', label: 'Lisboa (Portugal)' },
  { id: 'Europe/Madrid', label: 'Madri (Espanha)' },
  { id: 'Europe/London', label: 'Londres (Reino Unido)' },
  { id: 'Europe/Dublin', label: 'Dublin (Irlanda)' },
  { id: 'Europe/Paris', label: 'Paris (França)' },
  { id: 'Europe/Berlin', label: 'Berlim (Alemanha)' },
  { id: 'Europe/Rome', label: 'Roma (Itália)' },
  { id: 'Europe/Amsterdam', label: 'Amsterdã (Países Baixos)' },
]

const ALLOWED = new Set(TIMEZONE_OPTIONS.map((o) => o.id))

const dtfCache = new Map<string, Intl.DateTimeFormat>()
function dtf(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    })
    dtfCache.set(tz, f)
  }
  return f
}

/** O ambiente conhece este nome IANA? (`Intl.supportedValuesOf` quando existe; senão tenta criar o formatador). */
export function isKnownTimezone(tz: string): boolean {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 60) return false
  try {
    const sup = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf
    if (typeof sup === 'function' && sup('timeZone').includes(tz)) return true
  } catch {
    // ambiente sem a lista: cai para a tentativa abaixo
  }
  try {
    dtf(tz) // a lista do Intl traz só nomes canônicos; um apelido aceito pelo formatador também vale
    return true
  } catch {
    return false
  }
}

/** Valor aceito em Workspace.timezone: está na lista fechada de opções e o ambiente o conhece. */
export const isAllowedTimezone = (tz: string): boolean => ALLOWED.has(tz) && isKnownTimezone(tz)

/** Fuso válido para usar nas contas (cai para o padrão se vier vazio ou desconhecido). */
export function normTz(tz: string | null | undefined): string {
  return tz && isKnownTimezone(tz) ? tz : DEFAULT_TZ
}

export type TzParts = { year: number; month: number; day: number; hour: number; minute: number; second: number; dow: number; ymd: string }

const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
const p2 = (n: number) => String(n).padStart(2, '0')

/** Data e hora de parede de um instante, no fuso `tz` (dow: 0 = domingo). */
export function tzParts(d: Date, tz: string = DEFAULT_TZ): TzParts {
  const o: Record<string, string> = {}
  for (const p of dtf(tz).formatToParts(d)) o[p.type] = p.value
  const year = Number(o.year)
  const month = Number(o.month)
  const day = Number(o.day)
  return {
    year,
    month,
    day,
    hour: Number(o.hour) % 24,
    minute: Number(o.minute),
    second: Number(o.second),
    dow: DOW[o.weekday] ?? 0,
    ymd: `${String(year).padStart(4, '0')}-${p2(month)}-${p2(day)}`,
  }
}

/** Diferença (ms) entre o relógio de parede de `tz` e o UTC no instante `d` (negativa a oeste de Greenwich). */
export function tzOffsetMs(d: Date, tz: string = DEFAULT_TZ): number {
  const p = tzParts(d, tz)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(d.getTime() / 1000) * 1000
}

/** "-06:00" / "+01:00": o deslocamento do fuso no instante `d`, no formato aceito em datas ISO. */
export function tzOffsetString(d: Date, tz: string = DEFAULT_TZ): string {
  const min = Math.round(tzOffsetMs(d, tz) / 60_000)
  const abs = Math.abs(min)
  return `${min < 0 ? '-' : '+'}${p2(Math.floor(abs / 60))}:${p2(abs % 60)}`
}

/** "UTC-6" / "UTC+5:30": rótulo curto do deslocamento do fuso no instante `d`. */
export function tzOffsetLabel(tz: string = DEFAULT_TZ, d: Date = new Date()): string {
  const min = Math.round(tzOffsetMs(d, tz) / 60_000)
  const abs = Math.abs(min)
  const h = Math.floor(abs / 60)
  const m = abs % 60
  return `UTC${min < 0 ? '-' : '+'}${h}${m ? `:${p2(m)}` : ''}`
}

/** Nome do fuso para mostrar ("Cidade do México (Centro)"); fora da lista, o nome IANA. */
export const tzLabel = (tz: string): string => TIMEZONE_OPTIONS.find((o) => o.id === tz)?.label ?? tz

/** "Cidade do México (Centro), UTC-6" (nome e deslocamento atuais). */
export const tzLabelWithOffset = (tz: string, d: Date = new Date()): string => `${tzLabel(tz)}, ${tzOffsetLabel(tz, d)}`

/** Soma dias a uma data "YYYY-MM-DD" (calendário, sem fuso). */
export function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Data "YYYY-MM-DD" + "HH:MM" de parede no fuso `tz` -> instante UTC (resolve a virada do horário de verão). */
export function zonedToInstant(ymd: string, hm: string, tz: string = DEFAULT_TZ): Date {
  const [y, m, d] = ymd.split('-').map(Number)
  const [h, mi] = hm.split(':').map(Number)
  const wall = Date.UTC(y, m - 1, d, h, mi, 0)
  const off1 = tzOffsetMs(new Date(wall), tz)
  let guess = wall - off1
  const off2 = tzOffsetMs(new Date(guess), tz)
  if (off2 !== off1) guess = wall - off2
  return new Date(guess)
}

/** "HH:MM" de parede de um instante, no fuso `tz`. */
export function hmOf(d: Date, tz: string = DEFAULT_TZ): string {
  const p = tzParts(d, tz)
  return `${p2(p.hour)}:${p2(p.minute)}`
}

/** Data de parede "YYYY-MM-DD" de um instante, no fuso `tz` ("hoje", quando `d` é agora). */
export const ymdOf = (d: Date, tz: string = DEFAULT_TZ): string => tzParts(d, tz).ymd

/** Instante da meia-noite (no fuso `tz`) do dia de `d`. */
export const startOfDayTz = (d: Date, tz: string = DEFAULT_TZ): Date => zonedToInstant(ymdOf(d, tz), '00:00', tz)

/** Instante da meia-noite seguinte (no fuso `tz`). */
export const startOfNextDayTz = (d: Date, tz: string = DEFAULT_TZ): Date => zonedToInstant(addDaysYmd(ymdOf(d, tz), 1), '00:00', tz)

/** Próximo instante em que o relógio de `tz` marca `hour`:00 (hoje, se ainda não passou). */
export function nextHourTz(d: Date, hour: number, tz: string = DEFAULT_TZ): Date {
  const ymd = ymdOf(d, tz)
  const hm = `${p2(hour)}:00`
  const today = zonedToInstant(ymd, hm, tz)
  return today.getTime() >= d.getTime() ? today : zonedToInstant(addDaysYmd(ymd, 1), hm, tz)
}

/** "YYYY-MM" do instante `d` no fuso `tz`. */
export const monthKeyTz = (d: Date = new Date(), tz: string = DEFAULT_TZ): string => ymdOf(d, tz).slice(0, 7)

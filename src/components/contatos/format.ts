import { initials } from '@/components/pear'

const pad = (n: number) => String(n).padStart(2, '0')
const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const MONTHS_LONG = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
]

export const NONE = '—'

export const sigla = (name: string): string => initials(name).toUpperCase()

export const formatCount = (n: number): string => n.toLocaleString('pt-BR')

export const formatBRL = (n: number): string =>
  `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`

/** "Hoje", "Ontem" ou dd/mm. */
export function formatLastContact(iso: string | null): string {
  if (!iso) return NONE
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return NONE
  const now = new Date()
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (d.getTime() >= startToday) return 'Hoje'
  if (d.getTime() >= startToday - 86_400_000) return 'Ontem'
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`
}

/** "out 2026" */
export function formatSince(iso: string | null): string {
  if (!iso) return NONE
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return NONE
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`
}

/** "14 de março" (data guardada em UTC). */
export function formatBirthday(iso: string | null): string {
  if (!iso) return NONE
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return NONE
  return `${d.getUTCDate()} de ${MONTHS_LONG[d.getUTCMonth()]}`
}

export function todayStamp(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

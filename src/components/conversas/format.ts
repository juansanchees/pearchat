import { initialsOf } from '@/lib/initials'

// 1ª letra do 1º nome + 1ª letra do último (por grafema; emoji/símbolo não viram sigla).
export function initials(name: string): string {
  return initialsOf(name, 'last').toUpperCase()
}

const pad = (n: number) => String(n).padStart(2, '0')

export function formatHour(iso: string): string {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// Hora (hoje), "Ontem" ou dd/mm para a lista de conversas.
export function formatListTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (d.getTime() >= startToday) return formatHour(iso)
  if (d.getTime() >= startToday - 86_400_000) return 'Ontem'
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`
}

// +5511998124471 -> +55 11 99812-4471 (celular BR); outros formatos voltam como vieram.
export function formatPhone(tel: string | null): string {
  if (!tel) return ''
  const m = /^\+55(\d{2})(\d{5})(\d{4})$/.exec(tel)
  return m ? `+55 ${m[1]} ${m[2]}-${m[3]}` : tel
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

/** Chave do dia (fuso do navegador) para agrupar mensagens. */
export function dayKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** "Hoje", "Ontem" ou dd/mm/aaaa para o separador de dias da conversa. */
export function formatDayLabel(iso: string): string {
  const d = new Date(iso)
  const diff = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86_400_000)
  if (diff <= 0) return 'Hoje'
  if (diff === 1) return 'Ontem'
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}

/** 1,2 MB / 340 KB / 800 B. */
export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`
  if (n >= 1024) return `${Math.round(n / 1024)} KB`
  return `${n} B`
}

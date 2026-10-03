export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const first = parts[0][0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : ''
  return (first + last).toUpperCase()
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

import type { CampaignDTO, CampaignStatusKind } from '@/lib/types'
import type { Campanha, CampanhaStatus } from './mock-data'

const pad = (n: number) => String(n).padStart(2, '0')
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
const ddmm = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`

/** "dd/mm, HH:MM" a partir de um valor datetime-local (se inválido, devolve o texto cru). */
export function formatDt(v: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v)
  return m ? `${m[3]}/${m[2]}, ${m[4]}:${m[5]}` : v
}

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()

/** Quando será o envio: "em 1 h 20 min", "em 3 h", "amanhã, 09:00" ou "dd/mm, HH:MM". */
export function fmtQuando(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  const mins = Math.round((d.getTime() - now.getTime()) / 60000)
  if (mins <= 0) return 'agora'
  if (mins < 60) return `em ${mins} min`
  if (mins < 24 * 60 && sameDay(d, now)) {
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return m ? `em ${h} h ${m} min` : `em ${h} h`
  }
  const amanha = new Date(now)
  amanha.setDate(amanha.getDate() + 1)
  return sameDay(d, amanha) ? `amanhã, ${hhmm(d)}` : `${ddmm(d)}, ${hhmm(d)}`
}

export const fmtBRL = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const STATUS: Record<CampaignStatusKind, CampanhaStatus> = {
  agendada: 'Agendada',
  na_fila: 'Na fila',
  enviando: 'Enviando',
  pausada: 'Pausada',
  concluida: 'Concluída',
}

/** Converte a campanha da API no formato exibido pelo drawer e pela sidebar. */
export function toCampanha(c: CampaignDTO): Campanha {
  const criada = new Date(c.createdAt)
  const intervalo = c.intervalo ? ` · intervalo ${c.intervalo.replace('-', '–')} s` : ''
  let data: string
  if (c.status === 'agendada' && c.scheduledAt) {
    const d = new Date(c.scheduledAt)
    data = `Agendada para ${ddmm(d)}, ${hhmm(d)}`
  } else if (c.status === 'concluida') {
    data = `${ddmm(criada)}, ${hhmm(criada)}`
  } else {
    data = `${sameDay(criada, new Date()) ? 'Hoje' : ddmm(criada)}, ${hhmm(criada)}${intervalo}`
  }
  return { id: c.id, lista: c.listaNome, total: c.total, enviadas: c.enviadas, respostas: c.respostas, status: STATUS[c.status] ?? 'Na fila', data }
}

/** Amanhã às 10:00 no formato datetime-local (valor inicial do campo "Data e hora"). */
export function defaultDispData(now: Date = new Date()): string {
  const d = new Date(now)
  d.setDate(d.getDate() + 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T10:00`
}

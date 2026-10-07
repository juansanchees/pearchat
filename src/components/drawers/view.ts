import { DEFAULT_TZ, addDaysYmd, tzParts } from '@/lib/timezone'
import type { CampaignDTO, CampaignStatusKind } from '@/lib/types'
import type { Campanha, CampanhaStatus } from './mock-data'

// Datas de disparos e da fila do follow-up no relógio do ESPAÇO (`tz` = useAppState().locale.timezone): o silêncio, o
// horário permitido do follow-up e o agendamento de disparos valem no fuso do negócio, não no do navegador.
const pad = (n: number) => String(n).padStart(2, '0')
const hhmm = (d: Date, tz: string) => {
  const p = tzParts(d, tz)
  return `${pad(p.hour)}:${pad(p.minute)}`
}
const ddmm = (d: Date, tz: string) => {
  const p = tzParts(d, tz)
  return `${pad(p.day)}/${pad(p.month)}`
}
const ymd = (d: Date, tz: string) => tzParts(d, tz).ymd

/** "dd/mm, HH:MM" a partir de um valor datetime-local (se inválido, devolve o texto cru). */
export function formatDt(v: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v)
  return m ? `${m[3]}/${m[2]}, ${m[4]}:${m[5]}` : v
}

/** Quando será o envio: "em 1 h 20 min", "em 3 h", "amanhã, 09:00" ou "dd/mm, HH:MM" (relógio do fuso `tz`). */
export function fmtQuando(iso: string, now: Date = new Date(), tz: string = DEFAULT_TZ): string {
  const d = new Date(iso)
  const mins = Math.round((d.getTime() - now.getTime()) / 60000)
  if (mins <= 0) return 'agora'
  if (mins < 60) return `em ${mins} min`
  if (mins < 24 * 60 && ymd(d, tz) === ymd(now, tz)) {
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return m ? `em ${h} h ${m} min` : `em ${h} h`
  }
  return ymd(d, tz) === addDaysYmd(ymd(now, tz), 1) ? `amanhã, ${hhmm(d, tz)}` : `${ddmm(d, tz)}, ${hhmm(d, tz)}`
}

export const fmtBRL = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const STATUS: Record<CampaignStatusKind, CampanhaStatus> = {
  agendada: 'Agendada',
  na_fila: 'Na fila',
  enviando: 'Enviando',
  pausada: 'Pausada',
  concluida: 'Concluída',
}

/** Converte a campanha da API no formato exibido pelo drawer e pela sidebar (datas no fuso `tz` do espaço). */
export function toCampanha(c: CampaignDTO, tz: string = DEFAULT_TZ): Campanha {
  const criada = new Date(c.createdAt)
  const intervalo = c.intervalo ? ` · intervalo ${c.intervalo.replace('-', '–')} s` : ''
  let data: string
  if (c.status === 'agendada' && c.scheduledAt) {
    const d = new Date(c.scheduledAt)
    data = `Agendada para ${ddmm(d, tz)}, ${hhmm(d, tz)}`
  } else if (c.status === 'concluida') {
    data = `${ddmm(criada, tz)}, ${hhmm(criada, tz)}`
  } else {
    data = `${ymd(criada, tz) === ymd(new Date(), tz) ? 'Hoje' : ddmm(criada, tz)}, ${hhmm(criada, tz)}${intervalo}`
  }
  return { id: c.id, lista: c.listaNome, total: c.total, enviadas: c.enviadas, respostas: c.respostas, status: STATUS[c.status] ?? 'Na fila', data, ...(c.aguardandoHorario ? { retida: true } : {}) }
}

/** Amanhã (no fuso `tz`) às 10:00 no formato datetime-local (valor inicial do campo "Data e hora"). */
export function defaultDispData(now: Date = new Date(), tz: string = DEFAULT_TZ): string {
  return `${addDaysYmd(ymd(now, tz), 1)}T10:00`
}

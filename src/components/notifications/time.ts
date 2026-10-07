// Datas do painel de notificações no fuso do ESPAÇO (`tz` = useAppState().locale.timezone), pelo mesmo módulo da Agenda.
import { diffDays, toZoned } from '@/components/agenda/time'
import type { NotificationDTO } from '@/server/notifications/types'

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const diaTz = (iso: string, tz: string) => toZoned(iso, tz).date
const hojeTz = (agoraMs: number, tz: string) => diaTz(new Date(agoraMs).toISOString(), tz)

/** "agora", "há 5 min", "há 2 h" ou, para o que é mais velho, a hora ("14:32"). */
export function horaRelativa(iso: string, agoraMs: number, tz: string): string {
  const min = Math.floor((agoraMs - new Date(iso).getTime()) / 60_000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  if (min < 6 * 60 && diaTz(iso, tz) === hojeTz(agoraMs, tz)) return `há ${Math.floor(min / 60)} h`
  return toZoned(iso, tz).hm
}

/** Rótulo do grupo de dia: "Hoje", "Ontem" ou "Segunda, 29/09". */
export function rotuloDia(date: string, agoraMs: number, tz: string): string {
  const d = diffDays(hojeTz(agoraMs, tz), date)
  if (d === 0) return 'Hoje'
  if (d === -1) return 'Ontem'
  const [, mm, dd] = date.split('-')
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay()
  return `${cap(DIAS[dow])}, ${dd}/${mm}`
}

/** Agrupa (já em ordem, mais novo primeiro) por dia. */
export function agruparPorDia(itens: NotificationDTO[], agoraMs: number, tz: string): { rotulo: string; itens: NotificationDTO[] }[] {
  const grupos: { dia: string; rotulo: string; itens: NotificationDTO[] }[] = []
  for (const it of itens) {
    const dia = diaTz(it.ocorridoEm, tz)
    const g = grupos[grupos.length - 1]
    if (g && g.dia === dia) g.itens.push(it)
    else grupos.push({ dia, rotulo: rotuloDia(dia, agoraMs, tz), itens: [it] })
  }
  return grupos.map(({ rotulo, itens: l }) => ({ rotulo, itens: l }))
}

/** "14:32", "ontem, 22:10" ou "28/09, 22:10": desde quando a pessoa esteve fora. */
export function desdeLabel(iso: string, agoraMs: number, tz: string): string {
  const z = toZoned(iso, tz)
  const d = diffDays(hojeTz(agoraMs, tz), z.date)
  if (d === 0) return z.hm
  if (d === -1) return `ontem, ${z.hm}`
  const [, mm, dd] = z.date.split('-')
  return `${dd}/${mm}, ${z.hm}`
}

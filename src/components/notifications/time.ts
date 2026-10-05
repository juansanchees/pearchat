// Datas do painel de notificações (fuso de São Paulo, pelo mesmo módulo da Agenda).
import { diffDays, toSp } from '@/components/agenda/time'
import type { NotificationDTO } from '@/server/notifications/types'

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const spDia = (iso: string) => toSp(iso).date
const hojeSp = (agoraMs: number) => spDia(new Date(agoraMs).toISOString())

/** "agora", "há 5 min", "há 2 h" ou, para o que é mais velho, a hora ("14:32"). */
export function horaRelativa(iso: string, agoraMs: number): string {
  const min = Math.floor((agoraMs - new Date(iso).getTime()) / 60_000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  if (min < 6 * 60 && spDia(iso) === hojeSp(agoraMs)) return `há ${Math.floor(min / 60)} h`
  return toSp(iso).hm
}

/** Rótulo do grupo de dia: "Hoje", "Ontem" ou "Segunda, 29/09". */
export function rotuloDia(date: string, agoraMs: number): string {
  const d = diffDays(hojeSp(agoraMs), date)
  if (d === 0) return 'Hoje'
  if (d === -1) return 'Ontem'
  const [, mm, dd] = date.split('-')
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay()
  return `${cap(DIAS[dow])}, ${dd}/${mm}`
}

/** Agrupa (já em ordem, mais novo primeiro) por dia. */
export function agruparPorDia(itens: NotificationDTO[], agoraMs: number): { rotulo: string; itens: NotificationDTO[] }[] {
  const grupos: { dia: string; rotulo: string; itens: NotificationDTO[] }[] = []
  for (const it of itens) {
    const dia = spDia(it.ocorridoEm)
    const g = grupos[grupos.length - 1]
    if (g && g.dia === dia) g.itens.push(it)
    else grupos.push({ dia, rotulo: rotuloDia(dia, agoraMs), itens: [it] })
  }
  return grupos.map(({ rotulo, itens: l }) => ({ rotulo, itens: l }))
}

/** "14:32", "ontem, 22:10" ou "28/09, 22:10": desde quando a pessoa esteve fora. */
export function desdeLabel(iso: string, agoraMs: number): string {
  const sp = toSp(iso)
  const d = diffDays(hojeSp(agoraMs), sp.date)
  if (d === 0) return sp.hm
  if (d === -1) return `ontem, ${sp.hm}`
  const [, mm, dd] = sp.date.split('-')
  return `${dd}/${mm}, ${sp.hm}`
}

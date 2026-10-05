// Textos do sininho (português). Sem imports de servidor: o servidor monta o texto gravado e o cliente refaz o que
// depende do relógio (dia do agendamento: "amanhã" envelhece). Datas no fuso de São Paulo, pelo mesmo módulo da Agenda.
import { diffDays, toSp } from '@/components/agenda/time'
import type { NotifTipo } from './types'

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

/** "Teresa", "Teresa e Pao", "Teresa, Pao e Lu" ou, com mais de três, "Teresa, Pao e mais 2". */
export function nomesResumo(nomes: string[], total: number): string {
  const lista = nomes.filter(Boolean)
  if (lista.length === 0) return ''
  if (total <= 1 || lista.length === 1) return lista[0]
  if (total <= 3 && lista.length >= total) return `${lista.slice(0, total - 1).join(', ')} e ${lista[total - 1]}`
  const mostrados = lista.slice(0, 2)
  return `${mostrados.join(', ')} e mais ${total - mostrados.length}`
}

/** Dia relativo em São Paulo: "hoje", "amanhã", "ontem" ou "sexta, 10/10". */
export function diaRelativo(inicioIso: string, agoraMs: number): string {
  const alvo = toSp(inicioIso).date
  const hoje = toSp(new Date(agoraMs).toISOString()).date
  const d = diffDays(hoje, alvo)
  if (d === 0) return 'hoje'
  if (d === 1) return 'amanhã'
  if (d === -1) return 'ontem'
  const [, mm, dd] = alvo.split('-')
  const dow = new Date(`${alvo}T12:00:00Z`).getUTCDay()
  return `${DIAS[dow]}, ${dd}/${mm}`
}

/** "amanhã, 16:00", "hoje, 09:30" ou "sexta, 10/10 às 16:00". */
export function quandoAgenda(inicioIso: string, agoraMs: number): string {
  const dia = diaRelativo(inicioIso, agoraMs)
  const hm = toSp(inicioIso).hm
  return /^(hoje|amanhã|ontem)$/.test(dia) ? `${dia}, ${hm}` : `${dia} às ${hm}`
}

/** "AAAA-MM-DD" do agendamento em São Paulo (a Agenda abre nesse dia). */
export const diaDoAgendamento = (inicioIso: string): string => toSp(inicioIso).date

export const AGENDA_TITULO: Record<Extract<NotifTipo, `agenda_${string}`>, string> = {
  agenda_novo: 'Novo agendamento',
  agenda_remarcado: 'Agendamento remarcado',
  agenda_cancelado: 'Agendamento cancelado',
  agenda_confirmado: 'Presença confirmada',
  agenda_remarcar: 'Pediu para remarcar',
}

/** Plural simples: plural(2, 'conversa', 'conversas'). */
const pl = (n: number, um: string, varios: string) => (n === 1 ? um : varios)

/** O que as linhas agregadas guardam (Notification.refIds). */
export type AgregadoEstado = {
  /** Itens já somados (conversas, jobs...). Limitado; o excedente só conta em `extra`. */
  ids: string[]
  nomes: string[]
  motivos: Record<string, number>
  extra: number
}
export const totalDe = (e: AgregadoEstado): number => e.ids.length + e.extra

/** Motivo mais frequente. */
export function motivoComum(motivos: Record<string, number>): string | null {
  let melhor: string | null = null
  let n = 0
  for (const [m, c] of Object.entries(motivos)) {
    if (c > n) {
      melhor = m
      n = c
    }
  }
  return melhor
}

/** Título e linha secundária de uma notificação agregada (por conversa ou por contagem). */
export function textoAgregado(tipo: NotifTipo, e: AgregadoEstado): { titulo: string; corpo: string | null } {
  const n = totalDe(e)
  const um = e.nomes[0] ?? 'uma conversa'
  const nomes = n > 1 ? nomesResumo(e.nomes, n) || null : null
  const motivo = motivoComum(e.motivos)
  switch (tipo) {
    case 'ia_respondeu':
      return n === 1 ? { titulo: `A IA respondeu ${um}`, corpo: null } : { titulo: `A IA respondeu ${n} conversas`, corpo: nomes }
    case 'passou_para_voce':
      return n === 1
        ? { titulo: `A IA passou ${um} para a equipe`, corpo: motivo ? `Motivo: ${motivo}` : null }
        : { titulo: `A IA passou ${n} conversas para a equipe`, corpo: [nomes, motivo && Object.keys(e.motivos).length === 1 ? `Motivo: ${motivo}` : null].filter(Boolean).join(' · ') || null }
    case 'esperando_resposta':
      return n === 1 ? { titulo: `${um} está esperando você`, corpo: null } : { titulo: `${n} conversas esperando você`, corpo: nomes }
    case 'nova_conversa':
      return n === 1 ? { titulo: `Nova conversa com ${um}`, corpo: null } : { titulo: `${n} novas conversas`, corpo: nomes }
    case 'followup':
      return n === 1 ? { titulo: `Follow-up enviado para ${um}`, corpo: null } : { titulo: `Follow-up enviado para ${n} contatos`, corpo: nomes }
    case 'falha_envio':
      return {
        titulo: n === 1 ? '1 mensagem não foi enviada' : `${n} mensagens não foram enviadas`,
        corpo: motivo ? (n === 1 ? `Motivo: ${motivo}` : `Motivo mais comum: ${motivo}`) : null,
      }
    case 'agenda_novo':
      return { titulo: `${n} ${pl(n, 'agendamento novo', 'agendamentos novos')}`, corpo: nomes }
    case 'agenda_remarcado':
      return { titulo: `${n} ${pl(n, 'agendamento remarcado', 'agendamentos remarcados')}`, corpo: nomes }
    case 'agenda_cancelado':
      return { titulo: `${n} ${pl(n, 'agendamento cancelado', 'agendamentos cancelados')}`, corpo: nomes }
    case 'agenda_confirmado':
      return { titulo: `${n} ${pl(n, 'presença confirmada', 'presenças confirmadas')}`, corpo: nomes }
    case 'agenda_remarcar':
      return { titulo: `${n} ${pl(n, 'pedido para remarcar', 'pedidos para remarcar')}`, corpo: nomes }
    default:
      return { titulo: `${n} novidades`, corpo: nomes }
  }
}

/** Trecho do aviso "Enquanto você esteve fora: ..." para um tipo com `n` ocorrências. */
function trecho(tipo: NotifTipo, n: number, nivel?: number): string | null {
  switch (tipo) {
    case 'ia_respondeu':
      return `a IA respondeu ${n} ${pl(n, 'conversa', 'conversas')}`
    case 'passou_para_voce':
      return `a IA passou ${n} ${pl(n, 'conversa', 'conversas')} para a equipe`
    case 'esperando_resposta':
      return n === 1 ? '1 conversa espera você' : `${n} conversas esperam você`
    case 'nova_conversa':
      return `${n} ${pl(n, 'nova conversa', 'novas conversas')}`
    case 'agenda_novo':
      return `há ${n} ${pl(n, 'agendamento novo', 'agendamentos novos')}`
    case 'agenda_remarcado':
      return `${n} ${pl(n, 'agendamento remarcado', 'agendamentos remarcados')}`
    case 'agenda_cancelado':
      return `${n} ${pl(n, 'agendamento cancelado', 'agendamentos cancelados')}`
    case 'agenda_confirmado':
      return `${n} ${pl(n, 'presença confirmada', 'presenças confirmadas')}`
    case 'agenda_remarcar':
      return `${n} ${pl(n, 'pedido para remarcar', 'pedidos para remarcar')}`
    case 'followup':
      return `follow-up enviado para ${n} ${pl(n, 'contato', 'contatos')}`
    case 'campanha':
      return `${n} ${pl(n, 'campanha concluída', 'campanhas concluídas')}`
    case 'falha_envio':
      return `${n} ${pl(n, 'mensagem não enviada', 'mensagens não enviadas')}`
    case 'whatsapp_desconectou':
      return 'o WhatsApp desconectou'
    case 'whatsapp_reconectou':
      return 'o WhatsApp reconectou'
    case 'equipe_convite':
      return `${n} ${pl(n, 'pessoa entrou', 'pessoas entraram')} na equipe`
    case 'cota_ia':
      return nivel && nivel >= 100 ? 'a cota de IA do mês acabou' : 'a cota de IA do mês está perto do fim'
    default:
      return null
  }
}

/** Ordem em que os tipos aparecem no resumo (o mais urgente primeiro). */
const ORDEM_RESUMO: NotifTipo[] = [
  'whatsapp_desconectou',
  'passou_para_voce',
  'esperando_resposta',
  'ia_respondeu',
  'agenda_novo',
  'agenda_remarcar',
  'agenda_remarcado',
  'agenda_cancelado',
  'agenda_confirmado',
  'nova_conversa',
  'followup',
  'falha_envio',
  'campanha',
  'cota_ia',
  'whatsapp_reconectou',
  'equipe_convite',
]

/** "A IA respondeu 3 conversas e há 1 agendamento novo" (até 3 trechos), ou null se não houve nada. */
export function resumoAusente(contagens: Partial<Record<NotifTipo, number>>, nivelCota?: number): string | null {
  const partes: { texto: string; n: number }[] = []
  for (const t of ORDEM_RESUMO) {
    const n = contagens[t]
    if (!n) continue
    const texto = trecho(t, n, nivelCota)
    if (texto) partes.push({ texto, n })
  }
  if (partes.length === 0) return null
  // Curto: até 3 trechos; com mais que isso, os 2 mais urgentes e "e mais N novidades" (N = soma do que ficou de fora).
  let completo: string
  if (partes.length <= 3) {
    const t = partes.map((p) => p.texto)
    completo = t.length === 1 ? t[0] : `${t.slice(0, -1).join(', ')} e ${t[t.length - 1]}`
  } else {
    const resto = partes.slice(2).reduce((s, p) => s + p.n, 0)
    completo = `${partes[0].texto}, ${partes[1].texto} e mais ${resto} ${resto === 1 ? 'novidade' : 'novidades'}`
  }
  return completo.charAt(0).toUpperCase() + completo.slice(1)
}

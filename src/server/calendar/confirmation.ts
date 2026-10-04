import { db } from '@/lib/db'
import { diaSemanaOf, quandoExtenso } from '@/server/calendar/scheduling'
import { canSendFreeformTo } from '@/server/engine/freeform'
import { contactRef, OutboundError, sendAndRecord } from '@/server/engine/outbound'
import { agentMayReplyAt } from '@/server/engine/rules'
import { getConnected, log, logError, norm, shortError, spParts } from '@/server/engine/util'
import { loadConversationItem } from '@/server/messages/dto'
import { emitToWorkspace } from '@/server/realtime/emit'
import { notifySpaceAttention } from '@/server/spaces/attention'

// Confirmação de presença pelo lembrete. O lembrete (reminders.ts) pede "1 para confirmar, 2 para remarcar"; aqui a resposta do
// cliente é interpretada. Só age com resposta CLARA e só quando existe um agendamento com confirmação pendente cujo lembrete
// (que pediu confirmação) saiu nas últimas 36 h. Qualquer outra mensagem segue o fluxo normal.

export const CONFIRMATION_WINDOW_MS = 36 * 3_600_000
export const HANDOFF_REMARCAR = 'Cliente pediu para remarcar'
export const MSG_RECUSA = 'Tudo bem! Vou avisar a equipe para remarcar com você.'

export type ReplyKind = 'confirmar' | 'remarcar' | null

// Emojis de "ok" (👍 ✅ 👌 🙏), com ou sem tom de pele.
const THUMBS = ['👍', '✅', '👌', '🙏']
const CONFIRMA =
  /^(?:1|um|sim|s|ss|ok|okay|oks|blz|beleza|certo|combinado|fechado|confirmo|confirmado|confirmar|confirmada|pode confirmar|pode ser|pode sim|vou sim|(?:eu )?(?:vou|irei|estarei)(?: sim)?(?: la| ai)?|presenca confirmada|sim confirmo|sim confirmado|sim pode confirmar|com certeza|ta bom|tudo certo|ate la|ate amanha)(?: (?:obrigad[oa]|valeu|vlw|brigad[oa]))?$/
const REMARCA_EXATO = /^(?:2|nao|nao vou|nao posso|nao consigo|remarcar|remarca|reagendar|cancelar|cancela|desmarcar|quero remarcar|preciso remarcar)$/
const REMARCA_FRASE =
  /\b(?:remarcar|remarca|reagendar|desmarcar|cancelar|cancela)\b|\bnao (?:vou|posso|consigo|poderei|irei|vai dar|da pra|da para)\b|\b(?:mudar|trocar|alterar) (?:o )?(?:horario|dia)\b/

/** Classifica a resposta a um lembrete. Confirmar exige a mensagem INTEIRA ser uma confirmação; remarcar aceita frases curtas. */
export function classifyReminderReply(text: string): ReplyKind {
  const raw = text.trim()
  if (!raw || raw.length > 120) return null
  let emojis = raw.replace(/\uD83C[\uDFFB-\uDFFF]/g, '').replace(/[️\s]/g, '')
  for (const e of THUMBS) emojis = emojis.split(e).join('')
  if (emojis === '') return 'confirmar'
  const q = norm(raw)
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!q) return null
  const words = q.split(' ').length
  if (CONFIRMA.test(q)) return 'confirmar'
  if (REMARCA_EXATO.test(q)) return 'remarcar'
  if (words <= 14 && REMARCA_FRASE.test(q)) return 'remarcar'
  return null
}

const dia = (inicio: Date, now: Date): string => {
  const a = spParts(inicio)
  const b = spParts(now)
  if (a.ymd === b.ymd) return 'hoje'
  if (a.ymd === spParts(new Date(now.getTime() + 24 * 3_600_000)).ymd) return 'amanhã'
  const [, mm, dd] = a.ymd.split('-')
  return `${diaSemanaOf(a.ymd)} (${dd}/${mm})`
}
const hora = (d: Date): string => {
  const p = spParts(d)
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
}

/** Agendamento futuro e ativo do contato, com confirmação no estado `estado`, cujo lembrete com pedido saiu nas últimas 36 h. */
async function reminded(workspaceId: string, contactId: string, estado: 'pendente' | 'recusado', now: Date) {
  return db.event.findMany({
    where: {
      workspaceId,
      contactId,
      status: 'ativo',
      confirmacao: estado,
      inicio: { gt: now },
      reminders: { some: { pediuConfirmacao: true, result: 'enviado', sentAt: { gte: new Date(now.getTime() - CONFIRMATION_WINDOW_MS) } } },
    },
    orderBy: { inicio: 'asc' },
    take: 3,
    include: { serviceType: { select: { nome: true } } },
  })
}

/** Linha extra do prompt da IA quando o cliente pediu para remarcar respondendo ao lembrete. */
export async function remarcarContext(workspaceId: string, contactId: string, now: Date): Promise<string[]> {
  const list = await reminded(workspaceId, contactId, 'recusado', now)
  return list.map(
    (e) =>
      `O cliente respondeu ao lembrete do agendamento ${e.id} (${e.serviceType?.nome ?? e.tipo}, ${quandoExtenso(e.inicio)}) pedindo para remarcar. Conduza a remarcação: pergunte qual dia e período ele prefere, consulte os horários livres, confirme o novo horário e use remarcar_agendamento com esse id. Se ele preferir cancelar, confirme e use cancelar_agendamento.`,
  )
}

async function sendShort(workspaceId: string, conv: { id: string; mode: string | null }, contact: { waUserId: string | null; telefone: string | null; optOut: boolean }, text: string): Promise<void> {
  if (contact.optOut || conv.mode === 'HUMANO') return
  try {
    const session = await getConnected(workspaceId)
    if (!session) return
    const to = contactRef(contact)
    if (!(await canSendFreeformTo(session, to))) return
    await sendAndRecord({ session, conversationId: conv.id, to, author: 'IA', content: { kind: 'text', text }, countAtendimento: true })
  } catch (e) {
    logError('confirmation', 'resposta ao cliente falhou', e instanceof OutboundError ? new Error(shortError(e)) : e)
  }
}

/**
 * Interpreta a mensagem do cliente como resposta ao lembrete. Devolve `handled: true` quando já foi tratada por aqui (o ingest
 * NÃO agenda a resposta da IA). Nunca lança.
 */
export async function handleReminderReply(input: { workspaceId: string; conversationId: string; contactId: string; text: string; optOut: boolean }): Promise<{ handled: boolean }> {
  try {
    const kind = classifyReminderReply(input.text)
    if (!kind) return { handled: false }
    const { workspaceId, conversationId, contactId } = input
    const now = new Date()
    const [ev] = await reminded(workspaceId, contactId, 'pendente', now)
    if (!ev) return { handled: false }
    const conv = await db.conversation.findFirst({ where: { id: conversationId, workspaceId }, include: { contact: true } })
    if (!conv) return { handled: false }

    if (kind === 'confirmar') {
      const upd = await db.event.updateMany({ where: { id: ev.id, workspaceId, status: 'ativo', confirmacao: 'pendente' }, data: { confirmacao: 'confirmado', confirmadoEm: now } })
      if (upd.count === 0) return { handled: false }
      emitToWorkspace(workspaceId, 'agenda.updated', { workspaceId, confirmacao: { estado: 'confirmado', cliente: conv.contact.nome, inicio: ev.inicio.toISOString() } })
      await sendShort(workspaceId, conv, conv.contact, `Confirmado! Te esperamos ${dia(ev.inicio, now)} às ${hora(ev.inicio)}.`)
      log('confirmation', `evento ${ev.id} confirmado pelo cliente`)
      return { handled: true }
    }

    // Pediu para remarcar.
    const upd = await db.event.updateMany({ where: { id: ev.id, workspaceId, status: 'ativo', confirmacao: 'pendente' }, data: { confirmacao: 'recusado', confirmadoEm: null } })
    if (upd.count === 0) return { handled: false }
    emitToWorkspace(workspaceId, 'agenda.updated', { workspaceId, confirmacao: { estado: 'recusado', cliente: conv.contact.nome, inicio: ev.inicio.toISOString() } })

    // A IA com agendamento conduz a remarcação (a mensagem segue o fluxo normal, com o contexto do lembrete no prompt).
    const [agent, ws, servicos] = await Promise.all([
      db.aiAgent.findUnique({ where: { workspaceId } }),
      db.workspace.findUnique({ where: { id: workspaceId }, select: { horarioAtendimento: true } }),
      db.serviceType.count({ where: { workspaceId, ativo: true } }),
    ])
    const iaConduz =
      !!agent?.enabled && agent.canSchedule && servicos > 0 && conv.mode !== 'HUMANO' && !input.optOut && agentMayReplyAt(agent.horario, ws?.horarioAtendimento ?? null, now)
    if (iaConduz) return { handled: false }

    if (conv.mode === 'HUMANO') return { handled: true }
    await sendShort(workspaceId, conv, conv.contact, MSG_RECUSA)
    await db.conversation.update({ where: { id: conversationId }, data: { mode: 'HUMANO', typing: false } })
    const item = await loadConversationItem(workspaceId, conversationId)
    if (item) emitToWorkspace(workspaceId, 'conversation.updated', { workspaceId, conversation: item })
    emitToWorkspace(workspaceId, 'handoff.requested', { workspaceId, conversationId, contactName: conv.contact.nome, motivo: HANDOFF_REMARCAR })
    await notifySpaceAttention(workspaceId, { contato: conv.contact.nome, motivo: HANDOFF_REMARCAR })
    log('confirmation', `evento ${ev.id}: cliente pediu para remarcar; conversa passada para humano`)
    return { handled: true }
  } catch (e) {
    logError('confirmation', 'falha ao interpretar resposta ao lembrete', e)
    return { handled: false }
  }
}

import { db } from '@/lib/db'
import { emitToOrganization } from '@/server/realtime/emit'

/**
 * Avisa a sala da ORGANIZAÇÃO que um espaço tem novidade (mensagem nova ou passagem da IA), para os cartões dos
 * outros WhatsApps atualizarem os contadores. Só números/nomes, nunca conteúdo. Nunca lança: é conveniência e
 * não pode atrapalhar o recebimento da mensagem.
 */
export async function notifySpaceAttention(
  workspaceId: string,
  handoff?: { contato: string; motivo: string },
): Promise<void> {
  try {
    const ws = await db.workspace.findUnique({
      where: { id: workspaceId },
      select: { organizationId: true, nome: true, aiAgent: { select: { nome: true } } },
    })
    if (!ws?.organizationId) return
    const [sum, handoffs] = await Promise.all([
      db.conversation.aggregate({ where: { workspaceId, unread: { gt: 0 } }, _sum: { unread: true } }),
      db.conversation.count({ where: { workspaceId, mode: 'HUMANO', unread: { gt: 0 } } }),
    ])
    emitToOrganization(ws.organizationId, 'space.attention', {
      workspaceId,
      nome: ws.nome,
      unread: sum._sum.unread ?? 0,
      handoffs,
      ...(handoff ? { handoff: { agente: ws.aiAgent?.nome ?? 'A IA', contato: handoff.contato, motivo: handoff.motivo } } : {}),
    })
  } catch {
    // aviso é só uma conveniência
  }
}

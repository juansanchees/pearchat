import type { ConversationMode } from '@prisma/client'
import { db } from '@/lib/db'
import { cancelPendingFollowUps } from '@/server/engine/followup'
import { logError } from '@/server/engine/util'

/**
 * Regra ÚNICA de "resposta manual": uma pessoa respondeu o cliente (pelo app do PearChat OU direto no celular).
 * A conversa vai para HUMANO (com a IA ligada ou não), a IA para (os jobs dela são cancelados ao ver o modo), os
 * follow-ups pendentes são cancelados de vez ("Atendimento assumido") e a automação só volta com "Devolver para IA".
 * Usada por send.ts (envio pelo app) e pelo webhook da Evolution (mensagem `fromMe` vinda do celular).
 */
export async function registerManualReply(input: {
  conversationId: string
  /** Modo atual da conversa (só para não regravar à toa). */
  currentMode: ConversationMode | null
  /** Instante da mensagem enviada. */
  at: Date
  /** Equipe: quem respondeu pelo app. Conversa sem responsável passa a ser dessa pessoa. */
  userId?: string
}): Promise<{ tookOver: boolean }> {
  const { conversationId, currentMode, at, userId } = input
  const tookOver = currentMode !== 'HUMANO'
  await db.conversation.update({
    where: { id: conversationId },
    data: { unread: 0, typing: false, ...(tookOver ? { mode: 'HUMANO' as const } : {}) },
  })
  // Equipe: só atribui se ainda não há responsável (atômico: quem já tem dono não muda de mãos por responder).
  if (userId) await db.conversation.updateMany({ where: { id: conversationId, assigneeId: null }, data: { assigneeId: userId, assignedAt: at } })
  // lastMessageAt nunca regride (um webhook atrasado não pode fazer a conversa "voltar no tempo").
  await db.conversation.updateMany({
    where: { id: conversationId, OR: [{ lastMessageAt: null }, { lastMessageAt: { lt: at } }] },
    data: { lastMessageAt: at },
  })
  try {
    await cancelPendingFollowUps(conversationId, 'Atendimento assumido')
  } catch (e) {
    logError('takeover', 'cancelar follow-ups do atendimento assumido', e)
  }
  return { tookOver }
}

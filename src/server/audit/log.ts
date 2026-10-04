import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import type { AuditAction } from './labels'

export type { AuditAction } from './labels'

// Auditoria mínima. NUNCA registrar conteúdo de mensagens nem dados de contatos (nome, telefone, e-mail de cliente).
// O e-mail de quem foi convidado/removido é dado da EQUIPE (não de cliente) e fica só no `alvo` mascarado.
/** "ana@empresa.com" -> "a***@empresa.com": o log não precisa do e-mail inteiro. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@')
  return at > 0 ? `${email.slice(0, 1)}***${email.slice(at)}` : '***'
}

/** Registra um evento. Nunca lança (auditoria não pode derrubar a ação principal). */
export async function audit(input: {
  organizationId: string | null | undefined
  userId?: string | null
  workspaceId?: string | null
  acao: AuditAction
  alvo?: string | null
  meta?: Record<string, string | number | boolean | null>
}): Promise<void> {
  if (!input.organizationId) return
  try {
    await db.auditLog.create({
      data: {
        organizationId: input.organizationId,
        workspaceId: input.workspaceId ?? null,
        userId: input.userId ?? null,
        acao: input.acao,
        alvo: input.alvo ? input.alvo.slice(0, 200) : null,
        meta: input.meta ? (input.meta as Prisma.InputJsonValue) : undefined,
      },
    })
  } catch (e) {
    console.error('[audit] falha ao registrar:', e instanceof Error ? e.message : 'erro')
  }
}

/** Atalho para quem só tem o workspace (conexão do WhatsApp etc.). */
export async function auditWorkspace(workspaceId: string, userId: string | null, acao: AuditAction, alvo?: string | null): Promise<void> {
  try {
    const ws = await db.workspace.findUnique({ where: { id: workspaceId }, select: { organizationId: true, nome: true } })
    await audit({ organizationId: ws?.organizationId, userId, workspaceId, acao, alvo: alvo ?? ws?.nome })
  } catch {
    // auditoria é conveniência
  }
}

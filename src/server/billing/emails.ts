import { db } from '@/lib/db'
import { billingEmail } from '@/server/mail/templates'
import { mailConfigured, sendMail } from '@/server/mail/send'
import { log, logError } from '@/server/engine/util'

type Kind = Parameters<typeof billingEmail>[0]

/** Envia ao DONO da conta. Só envia com e-mail configurado; nunca lança (aviso é conveniência). Log sem endereço nem conteúdo. */
export async function sendBillingMail(organizationId: string, kind: Kind, data: Parameters<typeof billingEmail>[1] = {}): Promise<boolean> {
  try {
    if (!mailConfigured() && process.env.MAIL_DRY_RUN !== 'true') {
      log('billing', `e-mail ${kind}: não enviado (e-mail não configurado)`)
      return false
    }
    const owner = await db.user.findFirst({
      where: { organizationId, papel: 'owner', desativadoEm: null },
      orderBy: { createdAt: 'asc' },
      select: { email: true, nome: true },
    })
    if (!owner) return false
    const mail = billingEmail(kind, { nome: owner.nome, ...data })
    const r = await sendMail({ to: owner.email, ...mail })
    log('billing', `e-mail ${kind}: ${r.ok ? 'enviado' : 'não enviado'}`)
    return r.ok
  } catch (e) {
    logError('billing', `e-mail ${kind} falhou`, e)
    return false
  }
}

export const fmtDateBR = (d: Date): string => d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })

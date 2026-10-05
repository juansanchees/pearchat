import bcrypt from 'bcryptjs'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { newOrganizationBilling } from '@/server/billing/config'
import { consume, DAY, HOUR, hitCaps } from '@/server/security/rate-limit'

// Criação de conta (e-mail + senha): limites de abuso + criação atômica de Organization + Workspace + usuário dono.
// Separado da server action para poder ser testado sem o Next.

/** Teto GLOBAL de contas criadas por hora e por dia (qualquer IP): contém um robô com IPs rotativos. */
export const REGISTER_GLOBAL_PER_HOUR = 200
export const REGISTER_GLOBAL_PER_DAY = 1500

export const MSG_CADASTRO_BLOQUEADO = 'Muitas tentativas de cadastro. Tente de novo mais tarde.'
export const MSG_CADASTRO_INDISPONIVEL = 'O cadastro está temporariamente indisponível. Tente de novo em alguns minutos.'
export const MSG_EMAIL_EXISTE = 'Já existe uma conta com esse e-mail.'

export type RegisterResult =
  | { ok: true }
  | { ok: false; kind: 'blocked' | 'unavailable'; retryAfter: number; message: string }
  | { ok: false; kind: 'email_taken'; message: string }

export async function registerAccount(input: { empresa?: string; nome: string; email: string; password: string }, ip: string): Promise<RegisterResult> {
  const { empresa, nome, email, password } = input
  const nomeEmpresa = empresa && empresa.length >= 2 ? empresa : `Negócio de ${nome.split(/\s+/)[0]}`

  // 1) Por IP (5/h) e por e-mail (3/h): antes de qualquer consulta ao banco de contas e do bcrypt (que é caro).
  const rl = await consume('register', { email, ip })
  if (rl.blocked) return { ok: false, kind: 'blocked', retryAfter: rl.retryAfter, message: MSG_CADASTRO_BLOQUEADO }

  const exists = await db.user.findUnique({ where: { email }, select: { id: true } })
  if (exists) return { ok: false, kind: 'email_taken', message: MSG_EMAIL_EXISTE }

  // 2) Teto global de contas novas (só conta quem de fato vai criar conta).
  const cap = await hitCaps([
    { name: 'register-global-hour', key: 'all', max: REGISTER_GLOBAL_PER_HOUR, windowMs: HOUR },
    { name: 'register-global-day', key: 'all', max: REGISTER_GLOBAL_PER_DAY, windowMs: DAY },
  ])
  if (cap.blocked) return { ok: false, kind: 'unavailable', retryAfter: cap.retryAfter, message: MSG_CADASTRO_INDISPONIVEL }

  const passwordHash = await bcrypt.hash(password, 10)
  try {
    await db.$transaction(async (tx) => {
      // Conta = Organization (plano/assinatura) + primeiro espaço (WhatsApp) + usuário dono.
      const org = await tx.organization.create({ data: { nome: nomeEmpresa, ...newOrganizationBilling() } })
      const workspace = await tx.workspace.create({ data: { nome: nomeEmpresa, organizationId: org.id, plano: org.plano } })
      await tx.user.create({
        data: { workspaceId: workspace.id, organizationId: org.id, nome, email, passwordHash, papel: 'owner' },
      })
    })
  } catch (e) {
    // Dois cadastros simultâneos com o mesmo e-mail: a transação inteira é desfeita.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { ok: false, kind: 'email_taken', message: MSG_EMAIL_EXISTE }
    throw e
  }
  return { ok: true }
}

import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { resetIdentifier } from '@/app/api/auth/password/_lib/shared'

type GoogleAccount = { provider?: string; type?: string; providerAccountId?: string | null }
type GoogleProfile = { email?: string | null; email_verified?: boolean | null; picture?: string | null } | undefined

/** A conta que está entrando pelo Google (vinculada ou pelo e-mail) tem verificação em duas etapas ativa? */
export async function googleAccountHasTwoFactor(account: GoogleAccount, profile: GoogleProfile): Promise<boolean> {
  const sub = account.providerAccountId
  const linked = sub
    ? await db.account.findUnique({
        where: { provider_providerAccountId: { provider: 'google', providerAccountId: sub } },
        select: { user: { select: { totpEnabledAt: true } } },
      })
    : null
  if (linked) return !!linked.user.totpEnabledAt
  const email = profile?.email?.trim().toLowerCase()
  if (!email) return false
  const user = await db.user.findUnique({ where: { email }, select: { totpEnabledAt: true } })
  return !!user?.totpEnabledAt
}

/**
 * Chamado no callback `signIn` do Auth.js, ANTES de o usuário ser localizado/criado.
 *
 * - Recusa qualquer login Google cujo e-mail não venha com `email_verified === true`
 *   (o Google é quem garante que a pessoa é dona do e-mail).
 * - Se o e-mail já pertence a um usuário do PearChat (ex.: cadastro com senha) e esta conta
 *   Google ainda não está vinculada, vincula-a a esse usuário (cria o Account), sem criar outro User.
 * - Se o e-mail é novo, não faz nada: o adapter (createUser) cria Workspace + User.
 */
export async function authorizeGoogleSignIn(account: GoogleAccount, profile: GoogleProfile): Promise<boolean> {
  const email = profile?.email?.trim().toLowerCase()
  const sub = account.providerAccountId
  if (!email || !sub || profile?.email_verified !== true) return false

  const linked = await db.account.findUnique({
    where: { provider_providerAccountId: { provider: 'google', providerAccountId: sub } },
    select: { id: true },
  })
  if (linked) {
    // Equipe: removido da equipe não entra (a sessão também cai em src/auth.ts).
    const u = await db.account.findUnique({ where: { id: linked.id }, select: { user: { select: { desativadoEm: true } } } })
    return !u?.user.desativadoEm
  }

  const user = await db.user.findUnique({ where: { email }, select: { id: true, image: true, emailVerified: true, desativadoEm: true } })
  if (!user) return true
  if (user.desativadoEm) return false

  // Tudo na mesma transação: vínculo + (se a conta nunca provou ser dona do e-mail) anti pre-hijacking.
  try {
    await db.$transaction(async (tx) => {
      // Só guarda a identidade; os tokens do Google não são persistidos no login.
      await tx.account.create({
        data: { userId: user.id, type: account.type ?? 'oidc', provider: 'google', providerAccountId: sub },
      })
      const patch: Prisma.UserUpdateInput = {}
      if (!user.image && profile.picture) patch.image = profile.picture
      if (!user.emailVerified) {
        // Conta criada com e-mail+senha sem verificação: quem definiu a senha pode não ser o dono do e-mail.
        // O Google provou a posse, então a senha é descartada e os links de redefinição pendentes são invalidados.
        patch.emailVerified = new Date()
        patch.passwordHash = null
        await tx.verificationToken.deleteMany({ where: { identifier: resetIdentifier(email) } })
      }
      if (Object.keys(patch).length) await tx.user.update({ where: { id: user.id }, data: patch })
    })
  } catch (e) {
    // Dois callbacks simultâneos: o outro já vinculou.
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e
  }
  return true
}

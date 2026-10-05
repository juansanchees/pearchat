import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { resetIdentifier } from '@/app/api/auth/password/_lib/shared'
import { audit } from '@/server/audit/log'
import { invalidateActiveSpace } from '@/server/spaces/org'

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

/** allow = entra; deny = recusa genérica; needs-password = a conta existe mas NÃO provou o e-mail: entre com a senha. */
export type GoogleDecision = 'allow' | 'deny' | 'needs-password'

/**
 * Chamado no callback `signIn` do Auth.js, ANTES de o usuário ser localizado/criado.
 *
 * - Recusa qualquer login Google cujo e-mail não venha com `email_verified === true`
 *   (o Google é quem garante que a pessoa é dona do e-mail).
 * - Se o e-mail já pertence a um usuário do PearChat e esta conta Google ainda não está vinculada, só vincula se:
 *   (a) o e-mail dessa conta foi verificado por prova real (código/link entregue só à caixa de entrada, ou Google); ou
 *   (b) a conta é uma conta PRÓPRIA não verificada (dono único da própria organização): quem a criou pode ser um
 *       impostor com a senha dele, então o Google (que provou a posse) assume e a senha, o 2FA e as sessões antigas caem.
 *   Qualquer outra conta não verificada (ex.: criada por convite com o link passando por quem convidou, dentro da
 *   organização de outra pessoa) NÃO é vinculada: devolve 'needs-password' (nada é alterado).
 * - Se o e-mail é novo, não faz nada: o adapter (createUser) cria Workspace + User.
 */
export async function authorizeGoogleSignIn(account: GoogleAccount, profile: GoogleProfile): Promise<GoogleDecision> {
  const email = profile?.email?.trim().toLowerCase()
  const sub = account.providerAccountId
  if (!email || !sub || profile?.email_verified !== true) return 'deny'

  const linked = await db.account.findUnique({
    where: { provider_providerAccountId: { provider: 'google', providerAccountId: sub } },
    select: { id: true },
  })
  if (linked) {
    // Equipe: removido da equipe não entra (a sessão também cai em src/auth.ts).
    const u = await db.account.findUnique({ where: { id: linked.id }, select: { user: { select: { desativadoEm: true } } } })
    return u?.user.desativadoEm ? 'deny' : 'allow'
  }

  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, image: true, emailVerified: true, desativadoEm: true, papel: true, organizationId: true },
  })
  if (!user) return 'allow'
  if (user.desativadoEm) return 'deny'
  if (!user.emailVerified) {
    // Conta não verificada: só é "própria" se o dono é o único membro ativo da própria organização.
    const members = user.organizationId ? await db.user.count({ where: { organizationId: user.organizationId, desativadoEm: null } }) : 1
    const standalone = user.papel === 'owner' && members <= 1
    if (!standalone) return 'needs-password'
  }

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
        // O Google provou a posse, então a senha é descartada, o 2FA que o impostor possa ter ligado cai, as sessões
        // abertas por ele são revogadas e os links/códigos pendentes são invalidados.
        patch.emailVerified = new Date()
        patch.passwordHash = null
        patch.totpSecret = null
        patch.totpEnabledAt = null
        patch.totpLastStep = null
        patch.sessionVersion = { increment: 1 }
        await tx.recoveryCode.deleteMany({ where: { userId: user.id } })
        await tx.verificationToken.deleteMany({
          where: { OR: [{ identifier: resetIdentifier(email) }, { identifier: { in: [`emailverify:${user.id}`, `emailverify-sent:${user.id}`, `emailverify-try:${user.id}`] } }] },
        })
      }
      if (Object.keys(patch).length) await tx.user.update({ where: { id: user.id }, data: patch })
    })
    await audit({ organizationId: user.organizationId, userId: user.id, acao: 'account.google_linked', meta: { verificadoAntes: !!user.emailVerified } })
    invalidateActiveSpace(user.id)
  } catch (e) {
    // Dois callbacks simultâneos: o outro já vinculou.
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e
  }
  return 'allow'
}

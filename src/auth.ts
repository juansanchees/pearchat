import NextAuth, { CredentialsSignin } from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import Google from 'next-auth/providers/google'
import { z } from 'zod'
import { db } from '@/lib/db'
import { authConfig } from '@/auth.config'
import { pearchatAdapter } from '@/lib/auth-adapter'
import { authorizeGoogleSignIn, googleAccountHasTwoFactor } from '@/lib/auth-google'
import { googleLoginCredentials } from '@/lib/google-login'
import { resolveActiveSpace } from '@/server/spaces/org'
import { primaryLogin, secondFactorLogin } from '@/server/security/login'
import { clientIpFromHeaders } from '@/server/security/hash'

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})
// Segundo passo do 2FA: desafio assinado + código (TOTP ou de recuperação).
const secondFactorSchema = z.object({
  challenge: z.string().min(10).max(2000),
  code: z.string().min(1).max(40),
})

// Códigos que o formulário lê em `signIn(..., { redirect: false })` para distinguir o motivo da recusa.
export class RateLimitedError extends CredentialsSignin {
  code = 'rate_limited'
}
export class ChallengeExpiredError extends CredentialsSignin {
  code = 'challenge_expired'
}

const google = googleLoginCredentials()

export const { handlers, auth, signIn, signOut, unstable_update } = NextAuth({
  ...authConfig,
  adapter: pearchatAdapter(),
  session: { strategy: 'jwt' },
  // Primeiro login de uma conta nova (Google) segue para o onboarding.
  pages: { ...authConfig.pages, error: '/login', newUser: '/bem-vindo' },
  callbacks: {
    ...authConfig.callbacks,
    async jwt(params) {
      const token = await authConfig.callbacks.jwt(params)
      // Login novo: carimba a versão de sessão atual (incrementá-la no banco invalida os tokens antigos).
      if (params.user && token.userId) {
        const v = await db.user.findUnique({ where: { id: token.userId }, select: { sessionVersion: true } }).catch(() => null)
        token.sessionVersion = v?.sessionVersion ?? 0
      }
      // Troca de espaço (unstable_update) ou renovação: relê o usuário no banco (o Edge não tem Prisma).
      if (params.trigger === 'update' && token.userId) {
        try {
          const active = await resolveActiveSpace(token.userId)
          if (active) {
            token.workspaceId = active.workspaceId
            token.organizationId = active.organizationId
          }
        } catch (e) {
          console.error('[auth] jwt update:', e instanceof Error ? e.message : 'erro')
        }
      }
      return token
    },
    // O JWT pode ficar desatualizado (outra aba trocou de espaço, espaço arquivado): a cada leitura da sessão o
    // espaço ativo vem do BANCO, e é sempre um workspace da organização do usuário.
    async session(params) {
      const session = authConfig.callbacks.session(params)
      try {
        const active = await resolveActiveSpace(params.token.userId)
        if (active) {
          session.user.workspaceId = active.workspaceId
          session.user.organizationId = active.organizationId
          // "Sair de todos os dispositivos", troca de senha e desativação do 2FA: versão diferente = sessão revogada.
          if ((params.token.sessionVersion ?? 0) !== active.sessionVersion) {
            session.user.userId = ''
            session.user.workspaceId = ''
            session.user.organizationId = null
            session.user.invalid = true
          }
        }
      } catch (e) {
        // Banco indisponível / migração ainda não aplicada: segue com o que o token traz.
        console.error('[auth] session:', e instanceof Error ? e.message : 'erro')
      }
      return session
    },
    async signIn({ account, profile }) {
      if (account?.provider === 'google') {
        if (!(await authorizeGoogleSignIn(account, profile))) return false
        // Conta com 2FA ativo não entra só pelo Google (não pulamos o segundo fator em silêncio).
        if (await googleAccountHasTwoFactor(account, profile)) return '/login?error=GoogleMfa'
        return true
      }
      return true
    },
  },
  providers: [
    Credentials({
      credentials: { email: {}, password: {}, challenge: {}, code: {} },
      // ÚNICO ponto que emite sessão por credenciais (a rota /api/auth/callback/credentials também passa por aqui):
      // limite de tentativas e segundo fator são aplicados AQUI, não só no formulário.
      async authorize(raw, request) {
        const ip = clientIpFromHeaders(request?.headers)
        const second = secondFactorSchema.safeParse(raw)
        if (second.success) {
          const r = await secondFactorLogin(second.data.challenge, second.data.code, ip)
          if (r.kind === 'ok') return r.user
          if (r.kind === 'blocked') throw new RateLimitedError()
          if (r.kind === 'expired') throw new ChallengeExpiredError()
          return null
        }
        const parsed = credentialsSchema.safeParse(raw)
        if (!parsed.success) return null
        const r = await primaryLogin(parsed.data.email, parsed.data.password, ip)
        if (r.kind === 'ok') return r.user
        if (r.kind === 'blocked') throw new RateLimitedError()
        return null // inclui "mfa": senha certa com 2FA ativo NÃO gera sessão; só o segundo passo gera
      },
    }),
    // Só pede openid/email/profile; a Agenda é conectada à parte (/api/calendar/google/*).
    ...(google
      ? [Google({ ...google, authorization: { params: { scope: 'openid email profile', prompt: 'select_account' } } })]
      : []),
  ],
})

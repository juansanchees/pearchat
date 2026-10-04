import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import Google from 'next-auth/providers/google'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { db } from '@/lib/db'
import { authConfig } from '@/auth.config'
import { pearchatAdapter } from '@/lib/auth-adapter'
import { authorizeGoogleSignIn } from '@/lib/auth-google'
import { googleLoginCredentials } from '@/lib/google-login'
import { resolveActiveSpace } from '@/server/spaces/org'

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

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
        }
      } catch (e) {
        // Banco indisponível / migração ainda não aplicada: segue com o que o token traz.
        console.error('[auth] session:', e instanceof Error ? e.message : 'erro')
      }
      return session
    },
    async signIn({ account, profile }) {
      if (account?.provider === 'google') return authorizeGoogleSignIn(account, profile)
      return true
    },
  },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw)
        if (!parsed.success) return null
        const user = await db.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } })
        if (!user?.passwordHash) return null
        const ok = await bcrypt.compare(parsed.data.password, user.passwordHash)
        if (!ok) return null
        return {
          id: user.id,
          email: user.email,
          name: user.nome,
          image: user.fotoUrl ?? user.image,
          workspaceId: user.workspaceId,
          organizationId: user.organizationId ?? null,
          nome: user.nome,
        }
      },
    }),
    // Só pede openid/email/profile; a Agenda é conectada à parte (/api/calendar/google/*).
    ...(google
      ? [Google({ ...google, authorization: { params: { scope: 'openid email profile', prompt: 'select_account' } } })]
      : []),
  ],
})

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

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

const google = googleLoginCredentials()

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: pearchatAdapter(),
  session: { strategy: 'jwt' },
  // Primeiro login de uma conta nova (Google) segue para o onboarding.
  pages: { ...authConfig.pages, error: '/login', newUser: '/bem-vindo' },
  callbacks: {
    ...authConfig.callbacks,
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

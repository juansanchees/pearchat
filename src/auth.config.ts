import type { NextAuthConfig } from 'next-auth'

// Configuração compatível com Edge (sem Prisma/bcrypt). Usada pelo middleware
// e estendida em src/auth.ts com adapter e providers.
export const authConfig = {
  trustHost: true,
  pages: { signIn: '/login' },
  session: { strategy: 'jwt' },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.userId = user.id as string
        token.workspaceId = user.workspaceId
        token.nome = user.nome
      }
      return token
    },
    session({ session, token }) {
      session.user.userId = token.userId
      session.user.workspaceId = token.workspaceId
      session.user.nome = token.nome
      return session
    },
  },
} satisfies NextAuthConfig

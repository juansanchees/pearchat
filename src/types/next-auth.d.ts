import type { DefaultSession } from 'next-auth'

declare module 'next-auth' {
  interface User {
    workspaceId: string
    nome: string
  }
  interface Session {
    user: {
      userId: string
      workspaceId: string
      nome: string
    } & DefaultSession['user']
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    userId: string
    workspaceId: string
    nome: string
  }
}

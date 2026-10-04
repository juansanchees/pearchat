import type { DefaultSession } from 'next-auth'

declare module 'next-auth' {
  interface User {
    /** Espaço (WhatsApp) ativo do usuário. */
    workspaceId: string
    organizationId?: string | null
    nome: string
  }
  interface Session {
    user: {
      userId: string
      workspaceId: string
      /** Pode ser null em conta anterior à migração; o servidor cria a organização sob demanda. */
      organizationId: string | null
      nome: string
      /** owner | admin | agent, relido do banco a cada leitura da sessão (Equipe). */
      papel?: string
      /** true = sessão revogada (versão de sessão mudou); userId/workspaceId vêm vazios. */
      invalid?: boolean
    } & DefaultSession['user']
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    userId: string
    workspaceId: string
    organizationId: string | null
    nome: string
    sessionVersion?: number
  }
}

import type { Papel } from '@/server/auth/permissions'

export type MemberDTO = {
  id: string
  nome: string
  email: string
  papel: Papel
  fotoUrl: string | null
  /** Atendente: ids dos WhatsApps liberados. Dono/administrador: null (todos). */
  workspaceIds: string[] | null
  voce: boolean
}

export type InviteDTO = {
  id: string
  email: string
  papel: 'admin' | 'agent'
  workspaceIds: string[]
  createdAt: string
  expiraEm: string
  expirado: boolean
}

export type TeamResponse = {
  membros: MemberDTO[]
  convites: InviteDTO[]
  espacos: { id: string; nome: string }[]
  plano: 'ESSENCIAL' | 'PRO' | 'NEGOCIOS'
  limite: number
  /** Pessoas ativas + convites pendentes (o que conta para o limite). */
  usados: number
  /** false = sem serviço de e-mail: a tela mostra o link para o dono copiar. */
  emailConfigurado: boolean
  meuPapel: Papel
}

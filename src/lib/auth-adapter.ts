import { PrismaAdapter } from '@auth/prisma-adapter'
import type { Adapter, AdapterAccount, AdapterUser } from 'next-auth/adapters'
import type { User } from '@prisma/client'
import { db } from '@/lib/db'

// Converte a linha do banco no formato do Auth.js (name/image) mantendo workspaceId e nome.
function toAdapterUser(u: User): AdapterUser {
  return { ...u, name: u.nome, image: u.fotoUrl ?? u.image } as unknown as AdapterUser
}

/**
 * PrismaAdapter com createUser próprio: todo usuário precisa de um Workspace (workspaceId é obrigatório),
 * então Workspace + User nascem na mesma transação, igual ao cadastro por e-mail.
 */
export function pearchatAdapter(): Adapter {
  const base = PrismaAdapter(db)
  return {
    ...base,
    async createUser(data) {
      const email = data.email.toLowerCase()
      const nome = data.name?.trim() || email.split('@')[0]
      const user = await db.$transaction(async (tx) => {
        const workspace = await tx.workspace.create({ data: { nome: `Negócio de ${nome.split(/\s+/)[0]}` } })
        return tx.user.create({
          data: {
            workspaceId: workspace.id,
            nome,
            email,
            emailVerified: new Date(),
            image: data.image ?? null,
            papel: 'owner',
          },
        })
      })
      return toAdapterUser(user)
    },
    async getUser(id) {
      const u = await db.user.findUnique({ where: { id } })
      return u ? toAdapterUser(u) : null
    },
    async getUserByEmail(email) {
      const u = await db.user.findUnique({ where: { email: email.toLowerCase() } })
      return u ? toAdapterUser(u) : null
    },
    async getUserByAccount(provider_providerAccountId) {
      const acc = await db.account.findUnique({ where: { provider_providerAccountId }, include: { user: true } })
      return acc ? toAdapterUser(acc.user) : null
    },
    async updateUser({ id, name, ...rest }) {
      const data: Record<string, unknown> = { ...rest }
      if (name) data.nome = name
      delete data.workspaceId
      const u = await db.user.update({ where: { id }, data })
      return toAdapterUser(u)
    },
    // Não guarda access/refresh/id token do Google: o login só precisa da identidade.
    async linkAccount(account: AdapterAccount) {
      await db.account.create({
        data: {
          userId: account.userId,
          type: account.type,
          provider: account.provider,
          providerAccountId: account.providerAccountId,
          scope: account.scope ?? null,
          token_type: account.token_type ?? null,
        },
      })
    },
  }
}

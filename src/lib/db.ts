import { PrismaClient } from '@prisma/client'

// Singleton do PrismaClient POR PROCESSO. Fica sempre em globalThis (inclusive em produção): o server.ts e
// os bundles do Next são módulos distintos no mesmo processo e, sem isso, cada um abriria o seu próprio pool
// (o banco aceita poucas conexões no total).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({ log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'] })

globalForPrisma.prisma = db

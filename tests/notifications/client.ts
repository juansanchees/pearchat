// Cliente do Prisma com contador de consultas. Precisa ser carregado ANTES de src/lib/db (que reaproveita globalThis.prisma).
import assert from 'node:assert/strict'
import { PrismaClient } from '@prisma/client'

assert.match(new URL(process.env.DATABASE_URL ?? 'postgres://x/y').searchParams.get('schema') ?? '', /^pearchat_test_/, 'rode pelo lançador de um schema pearchat_test_*')

export const queries: string[] = []
export const counted = new PrismaClient({ log: [{ emit: 'event', level: 'query' }, 'error'] })
;(counted as unknown as { $on: (e: string, f: (q: { query: string }) => void) => void }).$on('query', (q) => queries.push(q.query))
;(globalThis as unknown as { prisma?: PrismaClient }).prisma = counted

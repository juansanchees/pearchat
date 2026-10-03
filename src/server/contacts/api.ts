import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'

export { sessionWorkspaceId, unauthorized, badRequest } from '@/server/messages/api'

export const contactNotFound = () => NextResponse.json({ error: 'Contato não encontrado' }, { status: 404 })
export const conflict = (message: string) => NextResponse.json({ error: message }, { status: 409 })
export const payloadTooLarge = (message: string) => NextResponse.json({ error: message }, { status: 413 })

export const DUPLICATE_PHONE_MESSAGE = 'Já existe um contato com este telefone'

/** Violação de unicidade (telefone repetido no workspace). */
export function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
}

export function zodMessage(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? 'Dados inválidos'
}

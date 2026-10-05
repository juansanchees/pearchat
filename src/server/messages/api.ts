import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { unauthorizedResponse } from '@/server/auth/availability'

// Workspace da sessão, ou null (a rota responde 401). Nunca aceita workspaceId do cliente.
export async function sessionWorkspaceId(): Promise<string | null> {
  const session = await auth()
  return session?.user?.workspaceId ?? null
}

// Equipe: usuário + workspace da sessão (autoria das mensagens, filtro "Minhas", atribuição), ou null (401).
export async function sessionIds(): Promise<{ userId: string; workspaceId: string; organizationId: string | null } | null> {
  const session = await auth()
  const userId = session?.user?.userId
  const workspaceId = session?.user?.workspaceId
  return userId && workspaceId ? { userId, workspaceId, organizationId: session?.user?.organizationId ?? null } : null
}

export const unauthorized = unauthorizedResponse // 401, ou 503 se o banco não deixou conferir a sessão
export const notFound = () => NextResponse.json({ error: 'Conversa não encontrada' }, { status: 404 })
export const badRequest = (message: string) => NextResponse.json({ error: message }, { status: 400 })

// Texto que o Postgres/Prisma não aceitam: NUL (\u0000) e surrogates soltos. Viram 400 em vez de 500.
const BAD_TEXT = /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

/** true se qualquer string do valor (em qualquer profundidade) tem caractere proibido. */
export function hasBadText(value: unknown, depth = 0): boolean {
  if (typeof value === 'string') return BAD_TEXT.test(value)
  if (depth > 8 || value === null || typeof value !== 'object') return false
  const items = Array.isArray(value) ? value : Object.entries(value).flat()
  return items.some((v) => hasBadText(v, depth + 1))
}

/** Corpo JSON da requisição, ou null se quebrado ou com texto proibido (a rota responde 400). */
export async function readJson(req: Request): Promise<unknown> {
  const body: unknown = await req.json().catch(() => null)
  return hasBadText(body) ? null : body
}

/** Remove NUL e surrogates soltos de um parâmetro de busca. */
export const cleanText = (s: string) => s.replace(new RegExp(BAD_TEXT.source, 'g'), '')

/** Ids do banco são cuid: qualquer outra coisa (inclusive %00) é "não encontrado", nunca erro. */
export const isValidId = (id: string) => /^[A-Za-z0-9_-]{1,64}$/.test(id)

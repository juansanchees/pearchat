import { NextResponse } from 'next/server'
import type { ZodType } from 'zod'
import { auth } from '@/auth'
import { readJson } from '@/server/messages/api'

export type ApiSession = { userId: string; workspaceId: string }

/** Sessão da requisição (nunca aceita workspaceId do cliente), ou null (a rota responde 401). */
export async function apiSession(): Promise<ApiSession | null> {
  const session = await auth()
  const userId = session?.user?.userId
  const workspaceId = session?.user?.workspaceId
  return userId && workspaceId ? { userId, workspaceId } : null
}

export const unauthorized = () => NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
export const notFound = (what = 'Item') => NextResponse.json({ error: `${what} não encontrado` }, { status: 404 })
export const fail = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

/** Lê e valida o corpo JSON. Devolve os dados ou uma resposta 400 pronta. */
export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<{ data: T } | { error: NextResponse }> {
  const raw = await readJson(req) // JSON quebrado ou com NUL/surrogate solto vira 400, nunca 500
  const parsed = schema.safeParse(raw)
  if (!parsed.success) return { error: fail(parsed.error.issues[0]?.message ?? 'Corpo inválido') }
  return { data: parsed.data }
}

import { NextResponse } from 'next/server'
import type { ZodType } from 'zod'
import { auth } from '@/auth'
import { unauthorizedResponse } from '@/server/auth/availability'
import { hasBadText, readJsonLimited, TOO_LARGE_MESSAGE } from '@/server/http/body'

export type ApiSession = { userId: string; workspaceId: string; organizationId: string | null; papel: string }

/** Sessão da requisição (nunca aceita workspaceId do cliente), ou null (a rota responde 401). */
export async function apiSession(): Promise<ApiSession | null> {
  const session = await auth()
  const userId = session?.user?.userId
  const workspaceId = session?.user?.workspaceId
  return userId && workspaceId
    ? { userId, workspaceId, organizationId: session?.user?.organizationId ?? null, papel: session?.user?.papel ?? 'agent' }
    : null
}

export const unauthorized = unauthorizedResponse // 401, ou 503 se o banco não deixou conferir a sessão
export const notFound = (what = 'Item') => NextResponse.json({ error: `${what} não encontrado` }, { status: 404 })
export const fail = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

/** Lê e valida o corpo JSON (com limite de tamanho). Devolve os dados ou uma resposta 413/400 pronta. */
export async function parseBody<T>(req: Request, schema: ZodType<T>, max?: number): Promise<{ data: T } | { error: NextResponse }> {
  const r = await readJsonLimited(req, max)
  if (!r.ok) return { error: fail(r.status === 413 ? TOO_LARGE_MESSAGE : 'Corpo inválido', r.status) }
  const raw = hasBadText(r.body) ? null : r.body // NUL/surrogate solto vira 400, nunca 500
  const parsed = schema.safeParse(raw)
  if (!parsed.success) return { error: fail(parsed.error.issues[0]?.message ?? 'Corpo inválido') }
  return { data: parsed.data }
}

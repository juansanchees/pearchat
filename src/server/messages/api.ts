import { NextResponse } from 'next/server'
import { auth } from '@/auth'

// Workspace da sessão, ou null (a rota responde 401). Nunca aceita workspaceId do cliente.
export async function sessionWorkspaceId(): Promise<string | null> {
  const session = await auth()
  return session?.user?.workspaceId ?? null
}

export const unauthorized = () => NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
export const notFound = () => NextResponse.json({ error: 'Conversa não encontrada' }, { status: 404 })
export const badRequest = (message: string) => NextResponse.json({ error: message }, { status: 400 })

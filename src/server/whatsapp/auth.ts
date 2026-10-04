import { auth } from '@/auth'

/** Sessão para route handlers: devolve null (o handler responde 401) em vez de redirecionar. */
export async function getApiSession(): Promise<{ userId: string; workspaceId: string; organizationId: string | null } | null> {
  const session = await auth()
  const userId = session?.user?.userId
  const workspaceId = session?.user?.workspaceId
  if (!userId || !workspaceId) return null
  return { userId, workspaceId, organizationId: session?.user?.organizationId ?? null }
}

import { redirect } from 'next/navigation'
import { auth } from '@/auth'

// Devolve a sessão do usuário (e seu workspace) ou redireciona para /login.
export async function requireSession(): Promise<{ userId: string; workspaceId: string }> {
  const session = await auth()
  const userId = session?.user?.userId
  const workspaceId = session?.user?.workspaceId
  if (!userId || !workspaceId) redirect('/login')
  return { userId, workspaceId }
}

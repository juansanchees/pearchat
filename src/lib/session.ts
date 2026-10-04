import { redirect } from 'next/navigation'
import { auth } from '@/auth'

// Devolve a sessão do usuário (e o espaço/WhatsApp ATIVO dele) ou redireciona para /login.
// workspaceId = espaço ativo (sempre da organização do usuário); organizationId pode ser null só se o banco falhou.
export async function requireSession(): Promise<{ userId: string; workspaceId: string; organizationId: string | null }> {
  const session = await auth()
  // Sessão revogada (sair de todos os dispositivos, troca de senha): tela própria, sem laço com o /login.
  if (session?.user?.invalid) redirect('/sessao-encerrada')
  const userId = session?.user?.userId
  const workspaceId = session?.user?.workspaceId
  if (!userId || !workspaceId) redirect('/login')
  return { userId, workspaceId, organizationId: session?.user?.organizationId ?? null }
}
